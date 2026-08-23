#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

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
import { blake2b } from '@noble/hashes/blake2.js';

import {
  MAKER_V8_SUI_GRPC_MAINNET_ENDPOINT,
  MAKER_V8_SUI_MAINNET_GENESIS_DIGEST,
  createProductionMakerV8SuiGrpcTransport,
  isMakerV8SuiGrpcNotFoundError,
} from '../maker-v8-sui-grpc.js';
import {
  ROLE_DEPENDENCIES,
  ROLE_ORDER,
  ROLE_PACKAGE_NAMES,
  MAINNET_V8_DEFAULT_COMMITTEE,
  MAINNET_V8_DEFAULT_COMMITTEE_CONTENT_SHA256,
  MAINNET_V8_DEFAULT_COMMITTEE_OWNER,
  MAINNET_V8_DEFAULT_COMMITTEE_TYPE,
  MAINNET_V8_RELEASE_SIGNER,
  MAINNET_V8_SUI_BINARY_SHA256,
  appendReleaseWal,
  assertMainnetV8FinalSealPolicy,
  assertMainnetV8SealPolicyTemplate,
  assertReleasePlan,
  buildAbiArtifact,
  buildFinalManifest,
  buildMainnetV8ManifestEvidence,
  buildMainnetV8OutcomeEvidence,
  buildMainnetV8ReadyEvidence,
  buildMainnetV8SignedEvidence,
  buildPackageArtifact,
  buildSealPolicy,
  buildSourceArtifact,
  canonicalJson,
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
import { deriveMakerV8ReleaseCommitments } from '../maker-v8-compiler.js';

export const MAINNET_V8_RELEASE_RUNNER_SCHEMA = 'animacraft.mainnet-v8-release-runner.v1';
export const MAINNET_V8_RELEASE_TOOLCHAIN = Object.freeze({
  suiVersion: '1.77.2',
  suiSourceCommit: '51d177ad7d65102fc368b582408f466d97b31548',
  suiVersionOutput: 'sui 1.77.2-51d177ad7d65',
  suiBinarySha256: MAINNET_V8_SUI_BINARY_SHA256,
  protocolVersion: '133',
  objectRuntimeMaxCachedObjects: '1000',
  objectRuntimeMaxStoreEntries: '1000',
  frameworkRevision: '73dd2c2ba6f9fdb21d7ffde2b50a3f2f0ac39bc1',
});
export const MAINNET_V8_USDC_TYPE =
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
export {
  MAINNET_V8_DEFAULT_COMMITTEE,
  MAINNET_V8_DEFAULT_COMMITTEE_CONTENT_SHA256,
  MAINNET_V8_DEFAULT_COMMITTEE_OWNER,
  MAINNET_V8_DEFAULT_COMMITTEE_TYPE,
  MAINNET_V8_RELEASE_SIGNER,
};
export const MAINNET_V8_DEFAULT_AGGREGATOR =
  'https://seal-aggregator-mainnet.mystenlabs.com';
export const MAINNET_V8_MAX_TRANSACTION_BYTES = 128 * 1024;
export const MAINNET_V8_PRELIMINARY_GAS_BUDGET = 2_000_000_000n;
export const MAINNET_V8_MINIMUM_GAS_CUSHION = 100_000_000n;
export const MAINNET_V8_WAL_FILENAME = 'release-wal.json';
export const MAINNET_V8_PLAN_FILENAME = 'release-plan.json';
export const MAINNET_V8_PUBLISHED_FILENAME = 'Published.toml';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const HEX_32 = /^[0-9a-f]{64}$/;
const BASE58_DIGEST_LENGTH = 32;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const LEDGER_SERVICE = 'sui.rpc.v2.LedgerService';
const GET_TRANSACTION = 'GetTransaction';
const COMMANDS = new Set(['prepare', 'run', 'resume', 'status', 'verify', 'export-config']);
const CONFIG_ROLE_MODULES = Object.freeze({
  seal: 'seal_v8',
  runtime: 'runtime_binding_v8',
  output: 'output_v8',
  physical: 'physical_v8',
  market: 'market_v8',
  release: 'release_v8',
});
const CONFIG_ROLE_FUNCTIONS = Object.freeze({
  seal: Object.freeze(['new_seal_policy_config_v8', 'share_seal_policy_config_v8']),
  runtime: Object.freeze(['new_runtime_package_config_v8', 'share_runtime_package_config_v8']),
  output: Object.freeze(['new_output_package_config_v8', 'share_output_package_config_v8']),
  physical: Object.freeze(['new_physical_package_config_v8', 'share_physical_package_config_v8']),
  market: Object.freeze(['new_market_package_config_v8', 'share_market_package_config_v8']),
  release: Object.freeze(['new_release_package_config_v8', 'share_release_package_config_v8']),
});
const MARKERS = Object.freeze({
  core: Object.freeze(['protocol_config_v8', 'CorePackageMarkerV8']),
  seal: Object.freeze(['seal_v8', 'SealOriginalMarkerV8', 'SealCallableMarkerV8']),
  runtime: Object.freeze(['runtime_v8', 'RuntimeOriginalMarkerV8', 'RuntimeCallableMarkerV8']),
  output: Object.freeze(['output_v8', 'OutputOriginalMarkerV8', 'OutputCallableMarkerV8']),
  physical: Object.freeze(['physical_v8', 'PhysicalOriginalMarkerV8', 'PhysicalCallableMarkerV8']),
  market: Object.freeze(['market_v8', 'MarketOriginalMarkerV8', 'MarketCallableMarkerV8']),
  release: Object.freeze(['release_v8', 'ReleaseOriginalMarkerV8', 'ReleaseCallableMarkerV8']),
});
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
const PROTOCOL_CONFIG_COMMITMENT_INPUT_BCS = bcs.struct('MainnetV8ProtocolConfigCommitmentInput', {
  domain: bcs.byteVector(),
  version: bcs.u64(),
  config_id: bcs.Address,
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
});
const PROTOCOL_TREASURY_INITIALIZED_EVENT_BCS = bcs.struct('MainnetV8ProtocolTreasuryInitialized', {
  config_id: bcs.Address,
  treasury_id: bcs.Address,
  revision: bcs.u64(),
  commitment: bcs.byteVector(),
});
const PROTOCOL_ENABLED_CHANGED_EVENT_BCS = bcs.struct('MainnetV8ProtocolEnabledChanged', {
  config_id: bcs.Address,
  revision: bcs.u64(),
  enabled: bcs.bool(),
  commitment: bcs.byteVector(),
});
const SEAL_KEY_SERVER_BINDING_BCS = bcs.struct('MainnetV8SealKeyServerBinding', {
  key_server_id: bcs.Address,
  weight: bcs.u16(),
});
const SEAL_POLICY_COMMITMENT_INPUT_BCS = bcs.struct('MainnetV8SealPolicyCommitmentInput', {
  domain: bcs.byteVector(),
  version: bcs.u64(),
  protocol_config_id: bcs.Address,
  protocol_config_revision: bcs.u64(),
  catalog_id: bcs.Address,
  product_binding_commitment: bcs.byteVector(),
  seal_original_package_id: bcs.Address,
  seal_callable_package_id: bcs.Address,
  seal_binding_commitment: bcs.byteVector(),
  seal_authority_id: bcs.Address,
  call_cap_set_commitment: bcs.byteVector(),
  key_servers: bcs.vector(SEAL_KEY_SERVER_BINDING_BCS),
  threshold: bcs.u16(),
  key_server_set_commitment: bcs.byteVector(),
  encryption_policy_commitment: bcs.byteVector(),
});
const SEAL_POLICY_CREATED_EVENT_BCS = bcs.struct('MainnetV8SealPolicyCreated', {
  config_id: bcs.Address,
  catalog_id: bcs.Address,
  threshold: bcs.u16(),
  key_server_set_commitment: bcs.byteVector(),
  commitment: bcs.byteVector(),
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
const PROTOCOL_BALANCE_BCS = bcs.struct('MainnetV8ProtocolBalance', {
  value: bcs.u64(),
});
const PROTOCOL_TREASURY_BCS = bcs.struct('MainnetV8ProtocolTreasury', {
  id: bcs.Address,
  version: bcs.u64(),
  config_id: bcs.Address,
  revenue: PROTOCOL_BALANCE_BCS,
  total_collected: bcs.u128(),
  total_withdrawn: bcs.u128(),
});
const PACKAGE_CALL_CAP_BCS = bcs.struct('MainnetV8PackageCallCap', {
  version: bcs.u64(),
  authority_id: bcs.Address,
  catalog_id: bcs.Address,
  product_binding_commitment: bcs.byteVector(),
  role_binding_commitment: bcs.byteVector(),
  call_cap_set_commitment: bcs.byteVector(),
});
const EXACT_PACKAGE_BINDING_BCS = bcs.struct('MainnetV8ExactPackageBinding', {
  original_package_id: bcs.Address,
  callable_package_id: bcs.Address,
  source_commitment: bcs.byteVector(),
  package_commitment: bcs.byteVector(),
  abi_commitment: bcs.byteVector(),
  commitment: bcs.byteVector(),
});
const PRODUCT_RELEASE_BINDING_BCS = bcs.struct('MainnetV8ProductReleaseBinding', {
  version: bcs.u64(),
  native_capability_mask: bcs.u64(),
  core: EXACT_PACKAGE_BINDING_BCS,
  seal: EXACT_PACKAGE_BINDING_BCS,
  runtime: EXACT_PACKAGE_BINDING_BCS,
  output: EXACT_PACKAGE_BINDING_BCS,
  physical: EXACT_PACKAGE_BINDING_BCS,
  market: EXACT_PACKAGE_BINDING_BCS,
  release: EXACT_PACKAGE_BINDING_BCS,
  commitment: bcs.byteVector(),
});
const PACKAGE_CALL_CAP_SET_BCS = bcs.struct('MainnetV8PackageCallCapSet', {
  version: bcs.u64(),
  catalog_id: bcs.Address,
  product_binding_commitment: bcs.byteVector(),
  seal_authority_id: bcs.Address,
  runtime_authority_id: bcs.Address,
  output_authority_id: bcs.Address,
  physical_authority_id: bcs.Address,
  market_authority_id: bcs.Address,
  release_authority_id: bcs.Address,
  commitment: bcs.byteVector(),
});
const PRODUCT_RELEASE_CATALOG_BCS = bcs.struct('MainnetV8ProductReleaseCatalog', {
  id: bcs.Address,
  version: bcs.u64(),
  protocol_config_id: bcs.Address,
  protocol_config_revision: bcs.u64(),
  protocol_config_commitment: bcs.byteVector(),
  binding: PRODUCT_RELEASE_BINDING_BCS,
  call_cap_set: PACKAGE_CALL_CAP_SET_BCS,
  seal_call_cap: bcs.option(PACKAGE_CALL_CAP_BCS),
  runtime_call_cap: bcs.option(PACKAGE_CALL_CAP_BCS),
  output_call_cap: bcs.option(PACKAGE_CALL_CAP_BCS),
  physical_call_cap: bcs.option(PACKAGE_CALL_CAP_BCS),
  market_call_cap: bcs.option(PACKAGE_CALL_CAP_BCS),
  release_call_cap: bcs.option(PACKAGE_CALL_CAP_BCS),
});
const SEAL_POLICY_CONFIG_BCS = bcs.struct('MainnetV8SealPolicyConfig', {
  id: bcs.Address,
  version: bcs.u64(),
  protocol_config_id: bcs.Address,
  protocol_config_revision: bcs.u64(),
  catalog_id: bcs.Address,
  product_binding_commitment: bcs.byteVector(),
  seal_original_package_id: bcs.Address,
  seal_callable_package_id: bcs.Address,
  seal_binding_commitment: bcs.byteVector(),
  seal_authority_id: bcs.Address,
  call_cap_set_commitment: bcs.byteVector(),
  seal_call_cap: PACKAGE_CALL_CAP_BCS,
  key_servers: bcs.vector(SEAL_KEY_SERVER_BINDING_BCS),
  threshold: bcs.u16(),
  key_server_set_commitment: bcs.byteVector(),
  encryption_policy_commitment: bcs.byteVector(),
  commitment: bcs.byteVector(),
});
const SIMPLE_PACKAGE_CONFIG_BCS = bcs.struct('MainnetV8SimplePackageConfig', {
  id: bcs.Address,
  version: bcs.u64(),
  catalog_id: bcs.Address,
  product_binding_commitment: bcs.byteVector(),
  call_cap: PACKAGE_CALL_CAP_BCS,
});
const BOUND_PACKAGE_CONFIG_BCS = bcs.struct('MainnetV8BoundPackageConfig', {
  id: bcs.Address,
  version: bcs.u64(),
  catalog_id: bcs.Address,
  product_binding_commitment: bcs.byteVector(),
  call_cap_set_commitment: bcs.byteVector(),
  call_cap: PACKAGE_CALL_CAP_BCS,
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
    if (['confirm-mainnet', 'allow-signing', 'allow-broadcast', 'json'].includes(name)) {
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
    fail('MAINNET_V8_TOOLCHAIN_DRIFT', 'Sui release binary differs from the approved protocol-133 toolchain.', {
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

export async function inspectMainnetV8GitSource(repositoryRoot = REPOSITORY_ROOT) {
  const [status, commit, tree] = await Promise.all([
    runProcess('git', ['status', '--porcelain=v1'], { cwd: repositoryRoot }),
    runProcess('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot }),
    runProcess('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repositoryRoot }),
  ]);
  if (status.stdout.length !== 0) {
    fail('MAINNET_V8_GIT_DIRTY', 'Mainnet release requires one clean committed source tree.', {
      status: status.stdout,
    });
  }
  return Object.freeze({ commit: commit.stdout.trim(), tree: tree.stdout.trim() });
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

async function archiveCleanSource({ repositoryRoot, commit, destination }) {
  await fsp.mkdir(destination, { recursive: true });
  const archivePath = path.join(path.dirname(destination), 'source.tar');
  await runProcess('git', ['archive', '--format=tar', `--output=${archivePath}`, commit], { cwd: repositoryRoot });
  await runProcess('tar', ['-xf', archivePath, '-C', destination]);
  await fsp.unlink(archivePath);
}

function listSourceFiles(packageDirectory) {
  const selected = [];
  for (const name of ['Move.toml', 'Move.lock']) {
    const filename = path.join(packageDirectory, name);
    if (!fs.existsSync(filename)) fail('MAINNET_V8_SOURCE_FILE_MISSING', `${filename} is missing.`);
    selected.push(filename);
  }
  const sourceRoot = path.join(packageDirectory, 'sources');
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(filename);
      else if (entry.isFile() && filename.endsWith('.move')) selected.push(filename);
    }
  };
  walk(sourceRoot);
  return selected.sort();
}

async function buildSourceArtifactForRole({ role, checkoutRoot, git, toolchain }) {
  const packageName = ROLE_PACKAGE_NAMES[role];
  const packageDirectory = path.join(checkoutRoot, 'move', packageName);
  return await buildSourceArtifact({
    role,
    packageName,
    release: { gitCommit: git.commit, gitTree: git.tree },
    toolchain: {
      suiVersion: toolchain.suiVersion,
      suiVersionOutput: toolchain.suiVersionOutput,
      suiSourceCommit: toolchain.suiSourceCommit,
      suiBinarySha256: toolchain.suiBinarySha256,
      frameworkRevision: toolchain.frameworkRevision,
    },
    files: await Promise.all(listSourceFiles(packageDirectory).map(async (filename) => {
      const bytes = new Uint8Array(await fsp.readFile(filename));
      return Object.freeze({
        path: path.relative(packageDirectory, filename).split(path.sep).join('/'),
        byteLength: String(bytes.length),
        sha256: sha256Hex(bytes),
      });
    })),
  });
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
  git,
  toolchain,
  sourceArtifact = null,
}) {
  if (!ROLE_ORDER.includes(role)) fail('MAINNET_V8_ROLE_INVALID', `Unknown role ${role}.`);
  const packageName = ROLE_PACKAGE_NAMES[role];
  const packageDirectory = path.join(checkoutRoot, 'move', packageName);
  const result = await runProcess(suiBinary, [
    'move', 'build', '--path', packageDirectory, '--force', '--warnings-are-errors',
    '--dump-bytecode-as-base64', '--build-env', 'mainnet', '--pubfile-path', publishedTomlPath,
  ], { cwd: checkoutRoot });
  const output = parseJsonOutput(result, `${role} move build`);
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
    role, checkoutRoot, git, toolchain,
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

function shared(transaction, reference, mutable) {
  exactKeys(reference, ['objectId', 'initialSharedVersion'], 'shared reference');
  return transaction.sharedObjectRef({
    objectId: address(reference.objectId, 'shared.objectId'),
    initialSharedVersion: decimal(reference.initialSharedVersion, 'shared.initialSharedVersion'),
    mutable,
  });
}

function owned(transaction, reference) {
  exactKeys(reference, ['objectId', 'version', 'digest'], 'owned reference');
  return transaction.objectRef({
    objectId: address(reference.objectId, 'owned.objectId'),
    version: decimal(reference.version, 'owned.version'),
    digest: digest(reference.digest, 'owned.digest'),
  });
}

export function buildMainnetV8InitTransaction({ packageIds, protocolConfig, protocolAdminCap, transactionContext }) {
  const transaction = new Transaction();
  const config = shared(transaction, protocolConfig, true);
  const admin = owned(transaction, protocolAdminCap);
  transaction.moveCall({
    target: `${packageIds.core}::protocol_config_v8::initialize_protocol_treasury_v8`,
    typeArguments: [MAINNET_V8_USDC_TYPE],
    arguments: [config, admin],
  });
  transaction.moveCall({
    target: `${packageIds.core}::protocol_config_v8::set_protocol_enabled_v8`,
    arguments: [config, admin, transaction.pure.bool(true)],
  });
  return configureMainnetV8Transaction(transaction, transactionContext);
}

function markerTypes(packageIds) {
  const coreMarker = `${packageIds.core}::${MARKERS.core[0]}::${MARKERS.core[1]}`;
  const values = [coreMarker, coreMarker];
  for (const role of ROLE_ORDER.slice(1)) {
    const [moduleName, original, callable] = MARKERS[role];
    values.push(`${packageIds[role]}::${moduleName}::${original}`);
    values.push(`${packageIds[role]}::${moduleName}::${callable}`);
  }
  return values;
}

export function buildMainnetV8BootstrapTransaction({
  packageIds,
  protocolConfig,
  protocolAdminCap,
  commitments,
  sealPolicy,
  transactionContext,
}) {
  const checkedPolicy = assertMainnetV8FinalSealPolicy(sealPolicy);
  const transaction = new Transaction();
  const config = shared(transaction, protocolConfig, false);
  const admin = owned(transaction, protocolAdminCap);
  const commitmentArgs = ROLE_ORDER.map((role) => {
    const value = commitments[role];
    exactKeys(value, ['source', 'package', 'abi'], `${role} commitments`);
    return transaction.moveCall({
      target: `${packageIds.core}::package_binding_v8::new_package_commitments_v8`,
      arguments: [
        transaction.pure.vector('u8', fromHex(hash32(value.source, `${role}.source`))),
        transaction.pure.vector('u8', fromHex(hash32(value.package, `${role}.package`))),
        transaction.pure.vector('u8', fromHex(hash32(value.abi, `${role}.abi`))),
      ],
    });
  });
  const catalog = transaction.moveCall({
    target: `${packageIds.core}::package_binding_v8::certify_product_release_catalog_v8`,
    typeArguments: markerTypes(packageIds),
    arguments: [config, admin, ...commitmentArgs],
  });
  for (const role of ROLE_ORDER.slice(1)) {
    const cap = transaction.moveCall({
      target: `${packageIds.core}::package_binding_v8::take_${role}_call_cap_v8`,
      arguments: [config, admin, catalog],
    });
    const [createName, shareName] = CONFIG_ROLE_FUNCTIONS[role];
    const moduleName = CONFIG_ROLE_MODULES[role];
    const args = role === 'seal'
      ? [
          config,
          admin,
          catalog,
          cap,
          transaction.pure.vector('address', checkedPolicy.keyServers.map((entry) => entry.objectId)),
          transaction.pure.vector('u16', checkedPolicy.keyServers.map((entry) => Number(entry.weight))),
          transaction.pure.u16(Number(checkedPolicy.threshold)),
          transaction.pure.vector('u8', fromHex(checkedPolicy.keyServerSetCommitment)),
          transaction.pure.vector('u8', fromHex(checkedPolicy.encryptionPolicyCommitment)),
        ]
      : [catalog, cap];
    const roleConfig = transaction.moveCall({
      target: `${packageIds[role]}::${moduleName}::${createName}`,
      arguments: args,
    });
    transaction.moveCall({
      target: `${packageIds[role]}::${moduleName}::${shareName}`,
      arguments: [roleConfig],
    });
  }
  transaction.moveCall({
    target: `${packageIds.core}::package_binding_v8::share_product_release_catalog_v8`,
    arguments: [catalog],
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
    'digest', 'effectsBcsBase64', 'gasUsed', 'recommendedGasBudget',
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
    || value.transactionDigest !== envelope.digest
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
export async function assertMainnetV8TransactionMatchesReady({
  ordinal,
  plan,
  readyArtifact,
  unsignedEnvelope,
}) {
  assertReleasePlan(plan);
  const ordinalText = decimal(String(ordinal), 'ordinal');
  if (BigInt(ordinalText) > 8n) {
    fail('MAINNET_V8_READY_TRANSACTION_DRIFT', 'Only transaction ordinals 0 through 8 have TransactionData.');
  }
  if (!plain(readyArtifact) || !plain(readyArtifact.protocolProfile)) {
    fail('MAINNET_V8_READY_TRANSACTION_DRIFT', 'READY artifact is malformed.');
  }
  const hydrated = hydrateMainnetV8UnsignedEnvelope(unsignedEnvelope);
  if (hydrated.sender !== plan.sender || hydrated.gasOwner !== plan.sender) {
    fail('MAINNET_V8_READY_TRANSACTION_DRIFT', 'READY sender/gas owner differs from the immutable plan.');
  }
  assertMainnetV8ReadyExecutionGates(plan, readyArtifact, hydrated);
  const transactionContext = transactionContextFromReady(plan, readyArtifact, hydrated);
  let expected;
  if (BigInt(ordinalText) < 7n) {
    const role = ROLE_ORDER[Number(ordinalText)];
    if (readyArtifact.kind !== 'PUBLISH' || readyArtifact.role !== role
      || !Array.isArray(readyArtifact.modules) || !Array.isArray(readyArtifact.dependencies)) {
      fail('MAINNET_V8_READY_TRANSACTION_DRIFT', 'Publish READY artifact differs from its ordinal.');
    }
    expected = buildMainnetV8PublishTransaction({
      modules: readyArtifact.modules,
      dependencies: readyArtifact.dependencies,
      transactionContext,
    });
  } else if (ordinalText === '7') {
    if (readyArtifact.kind !== 'INITIALIZE_PROTOCOL') {
      fail('MAINNET_V8_READY_TRANSACTION_DRIFT', 'Ordinal 7 must be INITIALIZE_PROTOCOL.');
    }
    exactKeys(
      readyArtifact.stageData,
      ['packageIds', 'protocolConfig', 'protocolAdminCap'],
      'INITIALIZE_PROTOCOL stageData',
    );
    expected = buildMainnetV8InitTransaction({
      packageIds: exactMainnetV8PackageIds(readyArtifact.stageData.packageIds),
      protocolConfig: readyArtifact.stageData.protocolConfig,
      protocolAdminCap: readyArtifact.stageData.protocolAdminCap,
      transactionContext,
    });
  } else {
    if (readyArtifact.kind !== 'BOOTSTRAP_RELEASE') {
      fail('MAINNET_V8_READY_TRANSACTION_DRIFT', 'Ordinal 8 must be BOOTSTRAP_RELEASE.');
    }
    exactKeys(
      readyArtifact.stageData,
      [
        'packageIds', 'protocolConfig', 'protocolAdminCap', 'commitments',
        'sealPolicy', 'keyServerCertificates',
      ],
      'BOOTSTRAP_RELEASE stageData',
    );
    if (!Array.isArray(readyArtifact.stageData.keyServerCertificates)
      || readyArtifact.stageData.keyServerCertificates.length
        !== readyArtifact.stageData.sealPolicy.keyServers.length) {
      fail('MAINNET_V8_READY_TRANSACTION_DRIFT', 'Bootstrap key-server certificates differ from Seal policy.');
    }
    expected = buildMainnetV8BootstrapTransaction({
      packageIds: exactMainnetV8PackageIds(readyArtifact.stageData.packageIds),
      protocolConfig: readyArtifact.stageData.protocolConfig,
      protocolAdminCap: readyArtifact.stageData.protocolAdminCap,
      commitments: exactMainnetV8Commitments(readyArtifact.stageData.commitments),
      sealPolicy: readyArtifact.stageData.sealPolicy,
      transactionContext,
    });
  }
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
  let gasBudget = MAINNET_V8_PRELIMINARY_GAS_BUDGET;
  let finalEnvelope = null;
  let finalSimulation = null;
  for (let pass = 0; pass < 4; pass += 1) {
    const context = releaseTransactionContext(profile, sender, gasBudget, nonce);
    const transaction = buildTransaction(context);
    const envelope = await inspectMainnetV8Transaction(transaction);
    if (envelope.sender !== sender || envelope.gasOwner !== sender) {
      fail('MAINNET_V8_SIGNER_DRIFT', 'Prepared transaction sender/gas owner differs from release signer.');
    }
    const simulation = await simulateMainnetV8Transaction(client, envelope);
    const recommended = BigInt(simulation.recommendedGasBudget);
    finalEnvelope = envelope;
    finalSimulation = simulation;
    if (recommended <= gasBudget) break;
    gasBudget = recommended;
  }
  if (finalEnvelope === null || BigInt(finalSimulation.recommendedGasBudget) > BigInt(finalEnvelope.gasBudget)) {
    fail('MAINNET_V8_GAS_BUDGET_UNSTABLE', 'Dry-run gas recommendation did not converge within the bounded passes.');
  }
  const balanceResponse = await client.core.getBalance({
    owner: sender,
    coinType: `${normalizeSuiAddress('0x2')}::sui::SUI`,
  });
  const balance = balanceResponse?.balance;
  const addressBalance = decimal(String(balance?.addressBalance), 'gasFunding.addressBalance');
  const coinBalance = decimal(String(balance?.coinBalance), 'gasFunding.coinBalance');
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

export async function simulateMainnetV8Transaction(client, envelope) {
  const result = await client.simulateTransaction({
    transaction: envelope.transactionBytes,
    checksEnabled: true,
    include: { effects: true, events: true, objectTypes: true, bcs: true, transaction: true },
  });
  const value = result?.$kind === 'Transaction' ? result.Transaction : result?.FailedTransaction;
  if (!value || value.digest !== envelope.digest || value.effects?.transactionDigest !== envelope.digest) {
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
  const gasUsed = value.effects.gasUsed;
  const gross = BigInt(gasUsed.computationCost) + BigInt(gasUsed.storageCost)
    + BigInt(gasUsed.nonRefundableStorageFee);
  const net = gross > BigInt(gasUsed.storageRebate) ? gross - BigInt(gasUsed.storageRebate) : gross;
  return Object.freeze({
    digest: envelope.digest,
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
  if (canonicalJson(onchainModules) !== canonicalJson(expectedModules)
    || canonicalJson(packageModuleMap) !== canonicalJson(expectedModules)) {
    fail('MAINNET_V8_PACKAGE_BYTES_DRIFT', `${role} on-chain modules differ from clean build bytes.`);
  }
  const call = client.movePackageService.getPackage({ packageId: reference.objectId });
  const response = await call.response;
  const packageMessage = officialMessage(response.package, GrpcTypes.Package, `${role} movePackageService.package`);
  const descriptor = normalizeMoveDescriptor(GrpcTypes.Package.toJson(packageMessage, {
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
  const observedDependencies = linkage.map((entry) => entry.originalId).sort();
  if (canonicalJson(observedDependencies) !== canonicalJson(expectedDependencies)
    || linkage.some((entry) => entry.upgradedId !== entry.originalId)) {
    fail('MAINNET_V8_PACKAGE_LINKAGE_DRIFT', `${role} Package BCS linkage differs from the exact build dependency DAG.`, {
      expectedDependencies,
      linkage,
    });
  }
  return Object.freeze({
    schemaVersion: MAINNET_V8_RELEASE_RUNNER_SCHEMA,
    role,
    transactionDigest,
    reference,
    moduleMapSha256: sha256Hex(new TextEncoder().encode(canonicalJson(onchainModules))),
    objectBcsSha256: sha256Hex(historical.objectBcs),
    typeOrigins,
    linkage,
    descriptor,
    abiArtifact,
  });
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
  const observed = String(value ?? '').replace(/^0x/, '').toLowerCase();
  return hash32(observed, label);
}

function normalizedPackageCallCapFromBcs(value, label) {
  if (!plain(value)) fail('MAINNET_V8_BOOTSTRAP_BCS_DRIFT', `${label} BCS is not one call capability.`);
  return Object.freeze({
    version: decimal(String(value.version), `${label}.version`),
    authorityId: address(value.authority_id, `${label}.authority_id`),
    catalogId: address(value.catalog_id, `${label}.catalog_id`),
    productBindingCommitment: moveHash(
      value.product_binding_commitment,
      `${label}.product_binding_commitment`,
    ),
    roleBindingCommitment: moveHash(
      value.role_binding_commitment,
      `${label}.role_binding_commitment`,
    ),
    callCapSetCommitment: moveHash(
      value.call_cap_set_commitment,
      `${label}.call_cap_set_commitment`,
    ),
  });
}

function normalizedPackageCallCapFromMove(value, label) {
  const fields = moveFields(value, label);
  exactKeys(fields, [
    'version', 'authority_id', 'catalog_id', 'product_binding_commitment',
    'role_binding_commitment', 'call_cap_set_commitment',
  ], `${label}.fields`);
  return Object.freeze({
    version: moveU64(fields.version, `${label}.version`),
    authorityId: moveId(fields.authority_id, `${label}.authority_id`),
    catalogId: moveId(fields.catalog_id, `${label}.catalog_id`),
    productBindingCommitment: moveHash(
      fields.product_binding_commitment,
      `${label}.product_binding_commitment`,
    ),
    roleBindingCommitment: moveHash(
      fields.role_binding_commitment,
      `${label}.role_binding_commitment`,
    ),
    callCapSetCommitment: moveHash(
      fields.call_cap_set_commitment,
      `${label}.call_cap_set_commitment`,
    ),
  });
}

function normalizedExactBindingFromBcs(value, label) {
  if (!plain(value)) fail('MAINNET_V8_BOOTSTRAP_BCS_DRIFT', `${label} BCS is not one exact binding.`);
  return Object.freeze({
    originalPackageId: address(value.original_package_id, `${label}.original_package_id`),
    callablePackageId: address(value.callable_package_id, `${label}.callable_package_id`),
    sourceCommitment: moveHash(value.source_commitment, `${label}.source_commitment`),
    packageCommitment: moveHash(value.package_commitment, `${label}.package_commitment`),
    abiCommitment: moveHash(value.abi_commitment, `${label}.abi_commitment`),
    commitment: moveHash(value.commitment, `${label}.commitment`),
  });
}

function normalizedExactBindingFromMove(value, label) {
  const fields = moveFields(value, label);
  exactKeys(fields, [
    'original_package_id', 'callable_package_id', 'source_commitment',
    'package_commitment', 'abi_commitment', 'commitment',
  ], `${label}.fields`);
  return Object.freeze({
    originalPackageId: moveId(fields.original_package_id, `${label}.original_package_id`),
    callablePackageId: moveId(fields.callable_package_id, `${label}.callable_package_id`),
    sourceCommitment: moveHash(fields.source_commitment, `${label}.source_commitment`),
    packageCommitment: moveHash(fields.package_commitment, `${label}.package_commitment`),
    abiCommitment: moveHash(fields.abi_commitment, `${label}.abi_commitment`),
    commitment: moveHash(fields.commitment, `${label}.commitment`),
  });
}

function normalizedProductBindingFromBcs(value, label) {
  if (!plain(value)) fail('MAINNET_V8_BOOTSTRAP_BCS_DRIFT', `${label} BCS is not a product binding.`);
  return Object.freeze({
    version: decimal(String(value.version), `${label}.version`),
    nativeCapabilityMask: decimal(
      String(value.native_capability_mask),
      `${label}.native_capability_mask`,
    ),
    roles: Object.freeze(Object.fromEntries(ROLE_ORDER.map((role) => [
      role,
      normalizedExactBindingFromBcs(value[role], `${label}.${role}`),
    ]))),
    commitment: moveHash(value.commitment, `${label}.commitment`),
  });
}

function normalizedProductBindingFromMove(value, label) {
  const fields = moveFields(value, label);
  exactKeys(fields, [
    'version', 'native_capability_mask', ...ROLE_ORDER, 'commitment',
  ], `${label}.fields`);
  return Object.freeze({
    version: moveU64(fields.version, `${label}.version`),
    nativeCapabilityMask: moveU64(
      fields.native_capability_mask,
      `${label}.native_capability_mask`,
    ),
    roles: Object.freeze(Object.fromEntries(ROLE_ORDER.map((role) => [
      role,
      normalizedExactBindingFromMove(fields[role], `${label}.${role}`),
    ]))),
    commitment: moveHash(fields.commitment, `${label}.commitment`),
  });
}

function normalizedCallCapSetFromBcs(value, label) {
  if (!plain(value)) fail('MAINNET_V8_BOOTSTRAP_BCS_DRIFT', `${label} BCS is not a call-cap set.`);
  return Object.freeze({
    version: decimal(String(value.version), `${label}.version`),
    catalogId: address(value.catalog_id, `${label}.catalog_id`),
    productBindingCommitment: moveHash(
      value.product_binding_commitment,
      `${label}.product_binding_commitment`,
    ),
    authorities: Object.freeze(Object.fromEntries(ROLE_ORDER.slice(1).map((role) => [
      role,
      address(value[`${role}_authority_id`], `${label}.${role}_authority_id`),
    ]))),
    commitment: moveHash(value.commitment, `${label}.commitment`),
  });
}

function normalizedCallCapSetFromMove(value, label) {
  const fields = moveFields(value, label);
  exactKeys(fields, [
    'version', 'catalog_id', 'product_binding_commitment',
    ...ROLE_ORDER.slice(1).map((role) => `${role}_authority_id`),
    'commitment',
  ], `${label}.fields`);
  return Object.freeze({
    version: moveU64(fields.version, `${label}.version`),
    catalogId: moveId(fields.catalog_id, `${label}.catalog_id`),
    productBindingCommitment: moveHash(
      fields.product_binding_commitment,
      `${label}.product_binding_commitment`,
    ),
    authorities: Object.freeze(Object.fromEntries(ROLE_ORDER.slice(1).map((role) => [
      role,
      moveId(fields[`${role}_authority_id`], `${label}.${role}_authority_id`),
    ]))),
    commitment: moveHash(fields.commitment, `${label}.commitment`),
  });
}

function moveOptionalCallCap(value, label) {
  if (!Array.isArray(value) || value.length > 1) {
    fail('MAINNET_V8_BOOTSTRAP_BCS_DRIFT', `${label} must be an exact Move Option<PackageCallCapV8>.`);
  }
  return value.length === 0 ? null : normalizedPackageCallCapFromMove(value[0], label);
}

function assertCatalogRawBcs(output) {
  const parsed = parseExactMoveContents(output, PRODUCT_RELEASE_CATALOG_BCS, 'ProductReleaseCatalogV8');
  const fields = moveFields(output.fields, 'ProductReleaseCatalogV8');
  exactKeys(fields, [
    'id', 'version', 'protocol_config_id', 'protocol_config_revision',
    'protocol_config_commitment', 'binding', 'call_cap_set',
    ...ROLE_ORDER.slice(1).map((role) => `${role}_call_cap`),
  ], 'ProductReleaseCatalogV8.fields');
  const fromBcs = Object.freeze({
    id: address(parsed.id, 'ProductReleaseCatalogV8.bcs.id'),
    version: decimal(String(parsed.version), 'ProductReleaseCatalogV8.bcs.version'),
    protocolConfigId: address(
      parsed.protocol_config_id,
      'ProductReleaseCatalogV8.bcs.protocol_config_id',
    ),
    protocolConfigRevision: decimal(
      String(parsed.protocol_config_revision),
      'ProductReleaseCatalogV8.bcs.protocol_config_revision',
    ),
    protocolConfigCommitment: moveHash(
      parsed.protocol_config_commitment,
      'ProductReleaseCatalogV8.bcs.protocol_config_commitment',
    ),
    binding: normalizedProductBindingFromBcs(parsed.binding, 'ProductReleaseCatalogV8.bcs.binding'),
    callCapSet: normalizedCallCapSetFromBcs(
      parsed.call_cap_set,
      'ProductReleaseCatalogV8.bcs.call_cap_set',
    ),
    callCaps: Object.freeze(Object.fromEntries(ROLE_ORDER.slice(1).map((role) => [
      role,
      parsed[`${role}_call_cap`] == null
        ? null
        : normalizedPackageCallCapFromBcs(
            parsed[`${role}_call_cap`],
            `ProductReleaseCatalogV8.bcs.${role}_call_cap`,
          ),
    ]))),
  });
  const fromMove = Object.freeze({
    id: moveId(fields.id, 'ProductReleaseCatalogV8.id'),
    version: moveU64(fields.version, 'ProductReleaseCatalogV8.version'),
    protocolConfigId: moveId(fields.protocol_config_id, 'ProductReleaseCatalogV8.protocol_config_id'),
    protocolConfigRevision: moveU64(
      fields.protocol_config_revision,
      'ProductReleaseCatalogV8.protocol_config_revision',
    ),
    protocolConfigCommitment: moveHash(
      fields.protocol_config_commitment,
      'ProductReleaseCatalogV8.protocol_config_commitment',
    ),
    binding: normalizedProductBindingFromMove(fields.binding, 'ProductReleaseCatalogV8.binding'),
    callCapSet: normalizedCallCapSetFromMove(fields.call_cap_set, 'ProductReleaseCatalogV8.call_cap_set'),
    callCaps: Object.freeze(Object.fromEntries(ROLE_ORDER.slice(1).map((role) => [
      role,
      moveOptionalCallCap(fields[`${role}_call_cap`], `ProductReleaseCatalogV8.${role}_call_cap`),
    ]))),
  });
  if (fromBcs.id !== output.reference.objectId
    || canonicalJson(fromBcs) !== canonicalJson(fromMove)
    || Object.values(fromBcs.callCaps).some((value) => value !== null)) {
    fail(
      'MAINNET_V8_BOOTSTRAP_BCS_DRIFT',
      'ProductReleaseCatalogV8 raw historical BCS differs from decoded fields or retains a call capability.',
    );
  }
  return fromBcs;
}

function normalizedConfigBaseFromBcs(value, label, { callCapSet }) {
  const result = {
    id: address(value.id, `${label}.id`),
    version: decimal(String(value.version), `${label}.version`),
    catalogId: address(value.catalog_id, `${label}.catalog_id`),
    productBindingCommitment: moveHash(
      value.product_binding_commitment,
      `${label}.product_binding_commitment`,
    ),
  };
  if (callCapSet) {
    result.callCapSetCommitment = moveHash(
      value.call_cap_set_commitment,
      `${label}.call_cap_set_commitment`,
    );
  }
  return result;
}

function normalizedConfigBaseFromMove(fields, label, { callCapSet }) {
  const result = {
    id: moveId(fields.id, `${label}.id`),
    version: moveU64(fields.version, `${label}.version`),
    catalogId: moveId(fields.catalog_id, `${label}.catalog_id`),
    productBindingCommitment: moveHash(
      fields.product_binding_commitment,
      `${label}.product_binding_commitment`,
    ),
  };
  if (callCapSet) {
    result.callCapSetCommitment = moveHash(
      fields.call_cap_set_commitment,
      `${label}.call_cap_set_commitment`,
    );
  }
  return result;
}

function assertCompanionConfigRawBcs(output, role) {
  const label = `${role} package config`;
  const simple = ['runtime', 'output'].includes(role);
  const schema = simple ? SIMPLE_PACKAGE_CONFIG_BCS : BOUND_PACKAGE_CONFIG_BCS;
  const capField = `${role}_call_cap`;
  const parsed = parseExactMoveContents(output, schema, label);
  const fields = moveFields(output.fields, label);
  exactKeys(fields, [
    'id', 'version', 'catalog_id', 'product_binding_commitment',
    ...(simple ? [] : ['call_cap_set_commitment']), capField,
  ], `${label}.fields`);
  const fromBcs = Object.freeze({
    ...normalizedConfigBaseFromBcs(parsed, `${label}.bcs`, { callCapSet: !simple }),
    callCap: normalizedPackageCallCapFromBcs(parsed.call_cap, `${label}.bcs.${capField}`),
  });
  const fromMove = Object.freeze({
    ...normalizedConfigBaseFromMove(fields, label, { callCapSet: !simple }),
    callCap: normalizedPackageCallCapFromMove(fields[capField], `${label}.${capField}`),
  });
  if (fromBcs.id !== output.reference.objectId
    || canonicalJson(fromBcs) !== canonicalJson(fromMove)) {
    fail('MAINNET_V8_BOOTSTRAP_BCS_DRIFT', `${label} raw historical BCS differs from decoded fields.`);
  }
  return fromBcs;
}

function assertSealConfigRawBcs(output) {
  const label = 'SealPolicyConfigV8';
  const parsed = parseExactMoveContents(output, SEAL_POLICY_CONFIG_BCS, label);
  const fields = moveFields(output.fields, label);
  exactKeys(fields, [
    'id', 'version', 'protocol_config_id', 'protocol_config_revision', 'catalog_id',
    'product_binding_commitment', 'seal_original_package_id', 'seal_callable_package_id',
    'seal_binding_commitment', 'seal_authority_id', 'call_cap_set_commitment',
    'seal_call_cap', 'key_servers', 'threshold', 'key_server_set_commitment',
    'encryption_policy_commitment', 'commitment',
  ], `${label}.fields`);
  if (!Array.isArray(fields.key_servers)) {
    fail('MAINNET_V8_BOOTSTRAP_BCS_DRIFT', `${label}.key_servers must be one exact vector.`);
  }
  const normalizeBcsKeyServer = (entry, entryLabel) => Object.freeze({
    objectId: address(entry.key_server_id, `${entryLabel}.key_server_id`),
    weight: decimal(String(entry.weight), `${entryLabel}.weight`),
  });
  const normalizeMoveKeyServer = (entry, entryLabel) => {
    const row = moveFields(entry, entryLabel);
    exactKeys(row, ['key_server_id', 'weight'], `${entryLabel}.fields`);
    return Object.freeze({
      objectId: moveId(row.key_server_id, `${entryLabel}.key_server_id`),
      weight: moveU64(row.weight, `${entryLabel}.weight`),
    });
  };
  const fromBcs = Object.freeze({
    id: address(parsed.id, `${label}.bcs.id`),
    version: decimal(String(parsed.version), `${label}.bcs.version`),
    protocolConfigId: address(parsed.protocol_config_id, `${label}.bcs.protocol_config_id`),
    protocolConfigRevision: decimal(
      String(parsed.protocol_config_revision),
      `${label}.bcs.protocol_config_revision`,
    ),
    catalogId: address(parsed.catalog_id, `${label}.bcs.catalog_id`),
    productBindingCommitment: moveHash(
      parsed.product_binding_commitment,
      `${label}.bcs.product_binding_commitment`,
    ),
    sealOriginalPackageId: address(
      parsed.seal_original_package_id,
      `${label}.bcs.seal_original_package_id`,
    ),
    sealCallablePackageId: address(
      parsed.seal_callable_package_id,
      `${label}.bcs.seal_callable_package_id`,
    ),
    sealBindingCommitment: moveHash(
      parsed.seal_binding_commitment,
      `${label}.bcs.seal_binding_commitment`,
    ),
    sealAuthorityId: address(parsed.seal_authority_id, `${label}.bcs.seal_authority_id`),
    callCapSetCommitment: moveHash(
      parsed.call_cap_set_commitment,
      `${label}.bcs.call_cap_set_commitment`,
    ),
    callCap: normalizedPackageCallCapFromBcs(parsed.seal_call_cap, `${label}.bcs.seal_call_cap`),
    keyServers: Object.freeze(parsed.key_servers.map((entry, index) => normalizeBcsKeyServer(
      entry,
      `${label}.bcs.key_servers[${index}]`,
    ))),
    threshold: decimal(String(parsed.threshold), `${label}.bcs.threshold`),
    keyServerSetCommitment: moveHash(
      parsed.key_server_set_commitment,
      `${label}.bcs.key_server_set_commitment`,
    ),
    encryptionPolicyCommitment: moveHash(
      parsed.encryption_policy_commitment,
      `${label}.bcs.encryption_policy_commitment`,
    ),
    commitment: moveHash(parsed.commitment, `${label}.bcs.commitment`),
  });
  const fromMove = Object.freeze({
    id: moveId(fields.id, `${label}.id`),
    version: moveU64(fields.version, `${label}.version`),
    protocolConfigId: moveId(fields.protocol_config_id, `${label}.protocol_config_id`),
    protocolConfigRevision: moveU64(
      fields.protocol_config_revision,
      `${label}.protocol_config_revision`,
    ),
    catalogId: moveId(fields.catalog_id, `${label}.catalog_id`),
    productBindingCommitment: moveHash(
      fields.product_binding_commitment,
      `${label}.product_binding_commitment`,
    ),
    sealOriginalPackageId: moveId(
      fields.seal_original_package_id,
      `${label}.seal_original_package_id`,
    ),
    sealCallablePackageId: moveId(
      fields.seal_callable_package_id,
      `${label}.seal_callable_package_id`,
    ),
    sealBindingCommitment: moveHash(
      fields.seal_binding_commitment,
      `${label}.seal_binding_commitment`,
    ),
    sealAuthorityId: moveId(fields.seal_authority_id, `${label}.seal_authority_id`),
    callCapSetCommitment: moveHash(
      fields.call_cap_set_commitment,
      `${label}.call_cap_set_commitment`,
    ),
    callCap: normalizedPackageCallCapFromMove(fields.seal_call_cap, `${label}.seal_call_cap`),
    keyServers: Object.freeze(fields.key_servers.map((entry, index) => normalizeMoveKeyServer(
      entry,
      `${label}.key_servers[${index}]`,
    ))),
    threshold: moveU64(fields.threshold, `${label}.threshold`),
    keyServerSetCommitment: moveHash(
      fields.key_server_set_commitment,
      `${label}.key_server_set_commitment`,
    ),
    encryptionPolicyCommitment: moveHash(
      fields.encryption_policy_commitment,
      `${label}.encryption_policy_commitment`,
    ),
    commitment: moveHash(fields.commitment, `${label}.commitment`),
  });
  if (fromBcs.id !== output.reference.objectId
    || canonicalJson(fromBcs) !== canonicalJson(fromMove)) {
    fail('MAINNET_V8_BOOTSTRAP_BCS_DRIFT', `${label} raw historical BCS differs from decoded fields.`);
  }
  return fromBcs;
}

export function assertMainnetV8BootstrapRawBcs(prepared) {
  const catalog = assertCatalogRawBcs(prepared.catalog);
  const configs = Object.freeze(Object.fromEntries(ROLE_ORDER.slice(1).map((role) => [
    role,
    role === 'seal'
      ? assertSealConfigRawBcs(prepared.configs[role])
      : assertCompanionConfigRawBcs(prepared.configs[role], role),
  ])));
  if (catalog.version !== '8' || catalog.binding.version !== '8'
    || catalog.binding.nativeCapabilityMask !== '127'
    || catalog.callCapSet.version !== '8'
    || Object.values(configs).some((config) => config.version !== '8')) {
    fail('MAINNET_V8_BOOTSTRAP_BCS_DRIFT', 'Bootstrap raw BCS has an unsupported version/capability mask.');
  }
  return Object.freeze({ catalog, configs });
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
    domain: new TextEncoder().encode('animacraft-v8/protocol-config'),
    version: '8',
    config_id: address(configId, 'protocol commitment.configId'),
    core_original_package_id: address(
      coreOriginalPackageId,
      'protocol commitment.coreOriginalPackageId',
    ),
    core_callable_package_id: address(
      coreCallablePackageId,
      'protocol commitment.coreCallablePackageId',
    ),
    revision: decimal(String(revision), 'protocol commitment.revision'),
    treasury_id: treasuryId == null
      ? null
      : address(treasuryId, 'protocol commitment.treasuryId'),
    payment_coin_type: MAINNET_V8_USDC_TYPE,
    primary_content_fee_bps: 1000,
    fixed_complete_fee_atomic: '0',
    maker_market_fee_bps: 250,
    soul_market_fee_bps: 250,
    enabled: moveBool(enabled, 'protocol commitment.enabled'),
  };
  let encoded;
  try {
    encoded = PROTOCOL_CONFIG_COMMITMENT_INPUT_BCS.serialize(input).toBytes();
  } catch (cause) {
    fail('MAINNET_V8_PROTOCOL_COMMITMENT_INVALID', 'ProtocolConfig commitment input is invalid.', {
      cause: String(cause?.message ?? cause),
    });
  }
  return sha256Hex(encoded);
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
  if (!Array.isArray(value) || value.length > 1) {
    fail('MAINNET_V8_MOVE_OPTION_INVALID', `${label} must be an exact Move Option<ID>.`);
  }
  return value.length === 0 ? null : moveId(value[0], label);
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
  const transactionDigest = digest(finalityEvidence.digest, 'finality.digest');
  const writes = writtenReferencesFromEffects(
    fromBase64(finalityEvidence.effectsBcsBase64),
    transactionDigest,
  );
  const created = writes.filter((entry) => entry.operation === 'CREATED');
  const expectedCreatedCount = role === 'core' ? 4 : 2;
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
  });
}

function assertEnabledProtocolConfig(output, packageIds, treasuryId) {
  const fields = moveFields(output.fields, 'ProtocolConfigV8');
  exactKeys(fields, [
    'id', 'version', 'core_original_package_id', 'core_callable_package_id',
    'revision', 'treasury_id', 'payment_coin_type', 'primary_content_fee_bps',
    'fixed_complete_fee_atomic', 'maker_market_fee_bps', 'soul_market_fee_bps',
    'enabled', 'commitment',
  ], 'ProtocolConfigV8.fields');
  if (moveId(fields.id, 'ProtocolConfigV8.id') !== output.reference.objectId
    || moveU64(fields.version, 'ProtocolConfigV8.version') !== '8'
    || moveId(fields.core_original_package_id, 'ProtocolConfigV8.core_original_package_id') !== packageIds.core
    || moveId(fields.core_callable_package_id, 'ProtocolConfigV8.core_callable_package_id') !== packageIds.core
    || moveU64(fields.revision, 'ProtocolConfigV8.revision') !== '2'
    || moveOptionId(fields.treasury_id, 'ProtocolConfigV8.treasury_id') !== treasuryId
    || fields.payment_coin_type !== MAINNET_V8_USDC_TYPE
    || moveU64(fields.primary_content_fee_bps, 'ProtocolConfigV8.primary_content_fee_bps') !== '1000'
    || moveU64(fields.fixed_complete_fee_atomic, 'ProtocolConfigV8.fixed_complete_fee_atomic') !== '0'
    || moveU64(fields.maker_market_fee_bps, 'ProtocolConfigV8.maker_market_fee_bps') !== '250'
    || moveU64(fields.soul_market_fee_bps, 'ProtocolConfigV8.soul_market_fee_bps') !== '250'
    || moveBool(fields.enabled, 'ProtocolConfigV8.enabled') !== true) {
    fail('MAINNET_V8_PROTOCOL_CONFIG_INVALID', 'Enabled ProtocolConfigV8 differs from exact init outcome.');
  }
  const expectedCommitment = expectedProtocolConfigCommitment(fields, output, {
    revision: '2',
    treasuryId,
    enabled: true,
  });
  if (moveHash(fields.commitment, 'ProtocolConfigV8.commitment') !== expectedCommitment) {
    fail('MAINNET_V8_PROTOCOL_COMMITMENT_DRIFT', 'Enabled ProtocolConfigV8 commitment is invalid.');
  }
  const parsed = parseExactMoveContents(output, PROTOCOL_CONFIG_BCS, 'enabled ProtocolConfigV8');
  if (parsed.id !== output.reference.objectId
    || parsed.version !== '8'
    || parsed.core_original_package_id !== packageIds.core
    || parsed.core_callable_package_id !== packageIds.core
    || parsed.revision !== '2'
    || parsed.treasury_id !== treasuryId
    || parsed.payment_coin_type !== MAINNET_V8_USDC_TYPE
    || parsed.primary_content_fee_bps !== 1000
    || parsed.fixed_complete_fee_atomic !== '0'
    || parsed.maker_market_fee_bps !== 250
    || parsed.soul_market_fee_bps !== 250
    || parsed.enabled !== true
    || moveHash(parsed.commitment, 'ProtocolConfigV8.bcs.commitment') !== expectedCommitment) {
    fail('MAINNET_V8_PROTOCOL_CONFIG_INVALID', 'Enabled ProtocolConfigV8 historical BCS differs from its exact decoded fields.');
  }
  return output;
}

function parseProtocolConfigEvent(event, {
  packageId,
  signer,
  name,
  schema,
  label,
}) {
  if (event.package_id !== packageId
    || event.transaction_module !== 'protocol_config_v8'
    || event.sender !== signer
    || event.event_type?.address !== packageId
    || event.event_type?.module !== 'protocol_config_v8'
    || event.event_type?.name !== name
    || !Array.isArray(event.event_type?.typeParams)
    || event.event_type.typeParams.length !== 0) {
    fail('MAINNET_V8_PROTOCOL_EVENT_DRIFT', `${label} event envelope is invalid.`, {
      event: canonicalizeSdk(event),
    });
  }
  let parsed;
  let roundtrip;
  const contents = Uint8Array.from(event.contents);
  try {
    parsed = schema.parse(contents);
    roundtrip = schema.serialize(parsed).toBytes();
  } catch (cause) {
    fail('MAINNET_V8_PROTOCOL_EVENT_DRIFT', `${label} event contents are invalid BCS.`, {
      cause: String(cause?.message ?? cause),
    });
  }
  if (!sameBytes(contents, roundtrip)) {
    fail('MAINNET_V8_PROTOCOL_EVENT_DRIFT', `${label} event contents are noncanonical.`);
  }
  return parsed;
}

export function assertMainnetV8ProtocolInitEvents({
  finalityEvidence,
  packageIds,
  signer,
  protocolConfigId,
  treasuryId,
}) {
  if (finalityEvidence.eventsDigest == null || finalityEvidence.transactionEvents == null) {
    fail('MAINNET_V8_PROTOCOL_EVENTS_MISSING', 'Protocol init must include its two exact events.');
  }
  let eventEnvelope;
  let roundtrip;
  try {
    const bytesValue = fromBase64(finalityEvidence.transactionEvents.bcsBase64);
    eventEnvelope = SUI_TRANSACTION_EVENTS_BCS.parse(bytesValue);
    roundtrip = SUI_TRANSACTION_EVENTS_BCS.serialize(eventEnvelope).toBytes();
    if (!sameBytes(bytesValue, roundtrip)) throw new Error('noncanonical TransactionEvents');
  } catch (cause) {
    fail('MAINNET_V8_PROTOCOL_EVENT_DRIFT', 'Protocol init TransactionEvents are invalid.', {
      cause: String(cause?.message ?? cause),
    });
  }
  if (eventEnvelope.data.length !== 2
    || finalityEvidence.transactionEvents.eventCount !== '2') {
    fail('MAINNET_V8_PROTOCOL_EVENT_CARDINALITY', 'Protocol init must emit exactly two events.');
  }
  const treasury = parseProtocolConfigEvent(eventEnvelope.data[0], {
    packageId: packageIds.core,
    signer,
    name: 'ProtocolTreasuryV8Initialized',
    schema: PROTOCOL_TREASURY_INITIALIZED_EVENT_BCS,
    label: 'ProtocolTreasuryV8Initialized',
  });
  const enabled = parseProtocolConfigEvent(eventEnvelope.data[1], {
    packageId: packageIds.core,
    signer,
    name: 'ProtocolV8EnabledChanged',
    schema: PROTOCOL_ENABLED_CHANGED_EVENT_BCS,
    label: 'ProtocolV8EnabledChanged',
  });
  const intermediateCommitment = deriveMainnetV8ProtocolConfigCommitment({
    configId: protocolConfigId,
    coreOriginalPackageId: packageIds.core,
    coreCallablePackageId: packageIds.core,
    revision: '1',
    treasuryId,
    enabled: false,
  });
  const finalCommitment = deriveMainnetV8ProtocolConfigCommitment({
    configId: protocolConfigId,
    coreOriginalPackageId: packageIds.core,
    coreCallablePackageId: packageIds.core,
    revision: '2',
    treasuryId,
    enabled: true,
  });
  if (treasury.config_id !== protocolConfigId
    || treasury.treasury_id !== treasuryId
    || String(treasury.revision) !== '1'
    || moveHash(treasury.commitment, 'ProtocolTreasuryV8Initialized.commitment')
      !== intermediateCommitment
    || enabled.config_id !== protocolConfigId
    || String(enabled.revision) !== '2'
    || enabled.enabled !== true
    || moveHash(enabled.commitment, 'ProtocolV8EnabledChanged.commitment') !== finalCommitment) {
    fail('MAINNET_V8_PROTOCOL_EVENT_DRIFT', 'Protocol init events do not bind the exact intermediate/final config commitments.');
  }
  return Object.freeze({
    treasuryInitialized: canonicalizeSdk(treasury),
    enabledChanged: canonicalizeSdk(enabled),
    intermediateCommitment,
    finalCommitment,
  });
}

function assertProtocolTreasury(output, configId) {
  const fields = moveFields(output.fields, 'ProtocolTreasuryV8');
  exactKeys(fields, [
    'id', 'version', 'config_id', 'revenue', 'total_collected', 'total_withdrawn',
  ], 'ProtocolTreasuryV8.fields');
  const revenue = moveFields(fields.revenue, 'ProtocolTreasuryV8.revenue');
  exactKeys(revenue, ['value'], 'ProtocolTreasuryV8.revenue.fields');
  if (moveId(fields.id, 'ProtocolTreasuryV8.id') !== output.reference.objectId
    || moveU64(fields.version, 'ProtocolTreasuryV8.version') !== '8'
    || moveId(fields.config_id, 'ProtocolTreasuryV8.config_id') !== configId
    || moveU64(revenue.value, 'ProtocolTreasuryV8.revenue.value') !== '0'
    || moveU64(fields.total_collected, 'ProtocolTreasuryV8.total_collected') !== '0'
    || moveU64(fields.total_withdrawn, 'ProtocolTreasuryV8.total_withdrawn') !== '0') {
    fail('MAINNET_V8_PROTOCOL_TREASURY_INVALID', 'ProtocolTreasuryV8 initial fields are invalid.');
  }
  const parsed = parseExactMoveContents(output, PROTOCOL_TREASURY_BCS, 'ProtocolTreasuryV8');
  if (parsed.id !== output.reference.objectId
    || parsed.version !== '8'
    || parsed.config_id !== configId
    || parsed.revenue.value !== '0'
    || parsed.total_collected !== '0'
    || parsed.total_withdrawn !== '0') {
    fail('MAINNET_V8_PROTOCOL_TREASURY_INVALID', 'ProtocolTreasuryV8 historical BCS differs from its decoded fields.');
  }
  return output;
}

export async function certifyMainnetV8ProtocolInit({
  transport,
  packageIds,
  protocolConfigId,
  signer,
  finalityEvidence,
}) {
  const transactionDigest = digest(finalityEvidence.digest, 'init finality.digest');
  const writes = writtenReferencesFromEffects(
    fromBase64(finalityEvidence.effectsBcsBase64),
    transactionDigest,
  );
  const configWrites = writes.filter((reference) => reference.objectId === protocolConfigId
    && reference.operation === 'MUTATED');
  const created = writes.filter((reference) => reference.operation === 'CREATED');
  if (writes.length !== 2 || configWrites.length !== 1 || created.length !== 1) {
    fail('MAINNET_V8_INIT_WRITE_SET_INVALID', 'Protocol init must mutate only config and create only treasury.', {
      writes,
    });
  }
  const relevant = [configWrites[0], created[0]];
  const outputs = await Promise.all(relevant.map((reference) => readExactMainnetV8MoveOutput({
    transport,
    reference,
    transactionDigest,
  })));
  const treasury = assertProtocolTreasury(exactType(
    outputs,
    `${packageIds.core}::protocol_config_v8::ProtocolTreasuryV8<${MAINNET_V8_USDC_TYPE}>`,
    'ProtocolTreasuryV8',
  ), protocolConfigId);
  const config = assertEnabledProtocolConfig(exactType(
    outputs,
    `${packageIds.core}::protocol_config_v8::ProtocolConfigV8`,
    'ProtocolConfigV8',
  ), packageIds, treasury.reference.objectId);
  const events = assertMainnetV8ProtocolInitEvents({
    finalityEvidence,
    packageIds,
    signer: address(signer, 'protocol init signer'),
    protocolConfigId,
    treasuryId: treasury.reference.objectId,
  });
  return Object.freeze({
    schemaVersion: MAINNET_V8_RELEASE_RUNNER_SCHEMA,
    kind: 'PROTOCOL_INIT_CERTIFICATE',
    transactionDigest,
    protocolConfig: config,
    protocolTreasury: treasury,
    events,
  });
}

function runtimeConfigFromBootstrap({ packageIds, initCertificate, outputs }) {
  const catalog = exactType(
    outputs,
    `${packageIds.core}::package_binding_v8::ProductReleaseCatalogV8`,
    'ProductReleaseCatalogV8',
  );
  const configTypes = {
    seal: `${packageIds.seal}::seal_v8::SealPolicyConfigV8`,
    runtime: `${packageIds.runtime}::runtime_binding_v8::RuntimePackageConfigV8`,
    output: `${packageIds.output}::output_v8::OutputPackageConfigV8`,
    physical: `${packageIds.physical}::physical_v8::PhysicalPackageConfigV8`,
    market: `${packageIds.market}::market_v8::MarketPackageConfigV8`,
    release: `${packageIds.release}::release_v8::ReleasePackageConfigV8`,
  };
  const configs = Object.fromEntries(Object.entries(configTypes).map(([role, type]) => [
    role,
    exactType(outputs, type, `${role} package config`),
  ]));
  return Object.freeze({
    runtimeConfig: Object.freeze({
      schemaVersion: 'animacraft.maker-v8-runtime.v8',
      protocolVersion: 8,
      enabled: true,
      catalogId: catalog.reference.objectId,
      protocolConfigId: initCertificate.protocolConfig.reference.objectId,
      protocolTreasuryId: initCertificate.protocolTreasury.reference.objectId,
      paymentCoinType: MAINNET_V8_USDC_TYPE,
      clockObjectId: normalizeSuiAddress('0x6'),
      roles: Object.fromEntries(ROLE_ORDER.map((role) => [role, {
        typeOriginPackageId: packageIds[role],
        callablePackageId: packageIds[role],
      }])),
      roleConfigIds: Object.fromEntries(Object.entries(configs).map(([role, output]) => [
        role,
        output.reference.objectId,
      ])),
      makerBindings: [],
    }),
    catalog,
    configs: Object.freeze(configs),
  });
}

export function deriveMainnetV8SealPolicyCommitment({
  protocolConfigId,
  catalogId,
  productBindingCommitment,
  sealOriginalPackageId,
  sealCallablePackageId,
  sealBindingCommitment,
  sealAuthorityId,
  callCapSetCommitment,
  sealPolicy,
}) {
  assertMainnetV8FinalSealPolicy(sealPolicy);
  const input = {
    domain: new TextEncoder().encode('animacraft-v8/seal/policy'),
    version: '8',
    protocol_config_id: address(protocolConfigId, 'Seal policy protocolConfigId'),
    protocol_config_revision: '2',
    catalog_id: address(catalogId, 'Seal policy catalogId'),
    product_binding_commitment: fromHex(hash32(
      productBindingCommitment,
      'Seal policy productBindingCommitment',
    )),
    seal_original_package_id: address(sealOriginalPackageId, 'Seal policy original package'),
    seal_callable_package_id: address(sealCallablePackageId, 'Seal policy callable package'),
    seal_binding_commitment: fromHex(hash32(
      sealBindingCommitment,
      'Seal policy bindingCommitment',
    )),
    seal_authority_id: address(sealAuthorityId, 'Seal policy authorityId'),
    call_cap_set_commitment: fromHex(hash32(
      callCapSetCommitment,
      'Seal policy callCapSetCommitment',
    )),
    key_servers: sealPolicy.keyServers.map((entry) => ({
      key_server_id: address(entry.objectId, 'Seal policy key server ID'),
      weight: Number(decimal(entry.weight, 'Seal policy key server weight')),
    })),
    threshold: Number(decimal(sealPolicy.threshold, 'Seal policy threshold')),
    key_server_set_commitment: fromHex(hash32(
      sealPolicy.keyServerSetCommitment,
      'Seal policy keyServerSetCommitment',
    )),
    encryption_policy_commitment: fromHex(hash32(
      sealPolicy.encryptionPolicyCommitment,
      'Seal policy encryptionPolicyCommitment',
    )),
  };
  return sha256Hex(SEAL_POLICY_COMMITMENT_INPUT_BCS.serialize(input).toBytes());
}

async function deriveBootstrapReleaseCommitments({ attested, packageIds }) {
  const roles = Object.fromEntries(ROLE_ORDER.map((role) => {
    const row = attested.catalog.roles[role];
    const marker = MARKERS[role];
    const module = marker[0];
    const originalMarker = marker[1];
    const callableMarker = marker[2] ?? marker[1];
    return [role, {
      originalPackageId: row.originalPackageId,
      callablePackageId: row.callablePackageId,
      sourceCommitment: row.sourceCommitment,
      packageCommitment: row.packageCommitment,
      abiCommitment: row.abiCommitment,
      bindingCommitment: row.commitment,
      originalMarkerType: `${packageIds[role]}::${module}::${originalMarker}`,
      callableMarkerType: `${packageIds[role]}::${module}::${callableMarker}`,
    }];
  }));
  const derived = await deriveMakerV8ReleaseCommitments({
    catalogId: attested.catalog.objectId,
    roles,
    authorities: attested.catalog.authorities,
  });
  if (derived.productBindingCommitment !== attested.catalog.productBindingCommitment
    || derived.callCapSetCommitment !== attested.catalog.callCapSetCommitment) {
    fail('MAINNET_V8_CATALOG_COMMITMENT_DRIFT', 'Catalog product/call-cap commitments do not derive from exact role bindings.');
  }
  return derived;
}

function assertSealBootstrapFields(
  sealConfig,
  sealPolicy,
  initCertificate,
  catalog,
  releaseCommitments,
) {
  const fields = moveFields(sealConfig.fields, 'SealPolicyConfigV8');
  const keyServers = fields.key_servers;
  if (!Array.isArray(keyServers) || keyServers.length !== sealPolicy.keyServers.length) {
    fail('MAINNET_V8_SEAL_POLICY_READBACK_DRIFT', 'Seal key-server row count differs from immutable release policy.');
  }
  keyServers.forEach((entry, index) => {
    const row = moveFields(entry, `SealPolicyConfigV8.key_servers[${index}]`);
    exactKeys(row, ['key_server_id', 'weight'], `SealPolicyConfigV8.key_servers[${index}]`);
    if (moveId(row.key_server_id, 'Seal key_server_id') !== sealPolicy.keyServers[index].objectId
      || moveU64(row.weight, 'Seal weight') !== sealPolicy.keyServers[index].weight) {
      fail('MAINNET_V8_SEAL_POLICY_READBACK_DRIFT', 'Seal key-server binding differs from immutable release policy.');
    }
  });
  const expectedCommitment = deriveMainnetV8SealPolicyCommitment({
    protocolConfigId: initCertificate.protocolConfig.reference.objectId,
    catalogId: catalog.reference?.objectId ?? catalog.objectId,
    productBindingCommitment: releaseCommitments.productBindingCommitment,
    sealOriginalPackageId: releaseCommitments.roles.seal.originalPackageId,
    sealCallablePackageId: releaseCommitments.roles.seal.callablePackageId,
    sealBindingCommitment: releaseCommitments.roles.seal.bindingCommitment,
    sealAuthorityId: releaseCommitments.authorities.seal,
    callCapSetCommitment: releaseCommitments.callCapSetCommitment,
    sealPolicy,
  });
  if (moveId(fields.protocol_config_id, 'Seal protocol_config_id')
      !== initCertificate.protocolConfig.reference.objectId
    || moveU64(fields.protocol_config_revision, 'Seal protocol_config_revision') !== '2'
    || moveId(fields.catalog_id, 'Seal catalog_id') !== catalog.reference.objectId
    || moveU64(fields.threshold, 'Seal threshold') !== sealPolicy.threshold
    || moveHash(fields.key_server_set_commitment, 'Seal key_server_set_commitment')
      !== sealPolicy.keyServerSetCommitment
    || moveHash(fields.encryption_policy_commitment, 'Seal encryption_policy_commitment')
      !== sealPolicy.encryptionPolicyCommitment
    || moveHash(fields.commitment, 'Seal commitment') !== expectedCommitment) {
    fail('MAINNET_V8_SEAL_POLICY_READBACK_DRIFT', 'SealPolicyConfigV8 differs from immutable release policy.');
  }
  return expectedCommitment;
}

export function assertMainnetV8BootstrapEvents({
  finalityEvidence,
  packageIds,
  signer,
  sealConfigId,
  catalogId,
  sealPolicy,
  sealPolicyCommitment,
}) {
  if (finalityEvidence.eventsDigest == null || finalityEvidence.transactionEvents == null) {
    fail('MAINNET_V8_BOOTSTRAP_EVENTS_MISSING', 'Bootstrap must include the exact Seal policy event.');
  }
  let envelope;
  try {
    const eventBytes = fromBase64(finalityEvidence.transactionEvents.bcsBase64);
    envelope = SUI_TRANSACTION_EVENTS_BCS.parse(eventBytes);
    const roundtrip = SUI_TRANSACTION_EVENTS_BCS.serialize(envelope).toBytes();
    if (!sameBytes(eventBytes, roundtrip)) throw new Error('noncanonical TransactionEvents');
  } catch (cause) {
    fail('MAINNET_V8_BOOTSTRAP_EVENT_DRIFT', 'Bootstrap TransactionEvents are invalid.', {
      cause: String(cause?.message ?? cause),
    });
  }
  if (envelope.data.length !== 1 || finalityEvidence.transactionEvents.eventCount !== '1') {
    fail('MAINNET_V8_BOOTSTRAP_EVENT_CARDINALITY', 'Bootstrap must emit exactly one SealPolicyCreatedV8 event.');
  }
  const event = envelope.data[0];
  if (event.package_id !== packageIds.seal
    || event.transaction_module !== 'seal_v8'
    || event.sender !== signer
    || event.event_type?.address !== packageIds.seal
    || event.event_type?.module !== 'seal_v8'
    || event.event_type?.name !== 'SealPolicyCreatedV8'
    || !Array.isArray(event.event_type?.typeParams)
    || event.event_type.typeParams.length !== 0) {
    fail('MAINNET_V8_BOOTSTRAP_EVENT_DRIFT', 'SealPolicyCreatedV8 event envelope is invalid.');
  }
  let parsed;
  const contents = Uint8Array.from(event.contents);
  try {
    parsed = SEAL_POLICY_CREATED_EVENT_BCS.parse(contents);
    const roundtrip = SEAL_POLICY_CREATED_EVENT_BCS.serialize(parsed).toBytes();
    if (!sameBytes(contents, roundtrip)) throw new Error('noncanonical event contents');
  } catch (cause) {
    fail('MAINNET_V8_BOOTSTRAP_EVENT_DRIFT', 'SealPolicyCreatedV8 event BCS is invalid.', {
      cause: String(cause?.message ?? cause),
    });
  }
  if (parsed.config_id !== sealConfigId
    || parsed.catalog_id !== catalogId
    || String(parsed.threshold) !== sealPolicy.threshold
    || moveHash(parsed.key_server_set_commitment, 'SealPolicyCreatedV8.key_server_set_commitment')
      !== sealPolicy.keyServerSetCommitment
    || moveHash(parsed.commitment, 'SealPolicyCreatedV8.commitment') !== sealPolicyCommitment) {
    fail('MAINNET_V8_BOOTSTRAP_EVENT_DRIFT', 'SealPolicyCreatedV8 event differs from exact bootstrap outputs.');
  }
  return Object.freeze(canonicalizeSdk(parsed));
}

export async function certifyMainnetV8Bootstrap({
  transport,
  packageIds,
  packageCommitments,
  initCertificate,
  sealPolicy,
  signer,
  finalityEvidence,
}) {
  const transactionDigest = digest(finalityEvidence.digest, 'bootstrap finality.digest');
  const writes = writtenReferencesFromEffects(
    fromBase64(finalityEvidence.effectsBcsBase64),
    transactionDigest,
  );
  const created = writes.filter((entry) => entry.operation === 'CREATED');
  if (writes.length !== 7 || created.length !== 7) {
    fail('MAINNET_V8_BOOTSTRAP_WRITE_SET_INVALID', 'Bootstrap effects must contain exactly seven created shared outputs.', {
      writes,
    });
  }
  const outputs = await Promise.all(created.map((reference) => readExactMainnetV8MoveOutput({
    transport,
    reference,
    transactionDigest,
  })));
  if (outputs.length !== 7 || outputs.some((output) => !Object.hasOwn(output.owner, 'Shared'))) {
    fail('MAINNET_V8_BOOTSTRAP_OUTPUT_CARDINALITY', 'Bootstrap must create exactly Catalog plus six shared configs.');
  }
  const prepared = runtimeConfigFromBootstrap({ packageIds, initCertificate, outputs });
  // Treat current JSON as a presentation layer only.  Every catalog/config
  // semantic field used below must first match the canonical historical BCS
  // created by this exact transaction.
  assertMainnetV8BootstrapRawBcs(prepared);
  const attested = await attestMakerV8Runtime(transport, prepared.runtimeConfig, { network: 'mainnet' });
  const exactAttestedObjects = [
    [attested.catalog, prepared.catalog, 'catalog'],
    ...Object.keys(prepared.configs).map((role) => [
      attested.configs[role], prepared.configs[role], `${role} config`,
    ]),
  ];
  for (const [observed, expected, label] of exactAttestedObjects) {
    if (canonicalJson(observed.objectRef) !== canonicalJson(expected.reference)) {
      fail('MAINNET_V8_BOOTSTRAP_ATTESTATION_DRIFT', `${label} attestation does not bind the exact created effects reference.`);
    }
  }
  const protocolFields = moveFields(initCertificate.protocolConfig.fields, 'ProtocolConfigV8');
  if (String(attested.catalog.protocolConfigRevision) !== '2'
    || attested.catalog.protocolConfigCommitment
      !== moveHash(protocolFields.commitment, 'ProtocolConfigV8.commitment')) {
    fail('MAINNET_V8_CATALOG_PROTOCOL_DRIFT', 'Catalog does not bind the exact enabled ProtocolConfig snapshot.');
  }
  const releaseCommitments = await deriveBootstrapReleaseCommitments({ attested, packageIds });
  for (const role of ROLE_ORDER) {
    const observed = attested.catalog.roles[role];
    const expected = packageCommitments[role];
    if (observed.sourceCommitment !== expected.source
      || observed.packageCommitment !== expected.package
      || observed.abiCommitment !== expected.abi) {
      fail('MAINNET_V8_CATALOG_COMMITMENT_DRIFT', `${role} catalog commitments differ from release artifacts.`);
    }
  }
  const sealPolicyCommitment = assertSealBootstrapFields(
    prepared.configs.seal,
    sealPolicy,
    initCertificate,
    prepared.catalog,
    releaseCommitments,
  );
  const events = assertMainnetV8BootstrapEvents({
    finalityEvidence,
    packageIds,
    signer: address(signer, 'bootstrap signer'),
    sealConfigId: prepared.configs.seal.reference.objectId,
    catalogId: prepared.catalog.reference.objectId,
    sealPolicy,
    sealPolicyCommitment,
  });
  return Object.freeze({
    schemaVersion: MAINNET_V8_RELEASE_RUNNER_SCHEMA,
    kind: 'BOOTSTRAP_CERTIFICATE',
    transactionDigest,
    runtimeConfig: prepared.runtimeConfig,
    catalog: prepared.catalog,
    configs: prepared.configs,
    releaseCommitments,
    sealPolicyCommitment,
    events,
    attestation: canonicalizeSdk({
      catalog: attested.catalog,
      configs: attested.configs,
      packageTuple: attested.packageTuple,
      coreArtifact: attested.coreArtifact,
    }),
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
  process.stdout.write(`Commands: prepare, run, resume, status, verify, export-config\n`);
  process.stdout.write(`Required for prepare: --state-dir PATH --sui-binary PATH --sender 0x...\n`);
  process.stdout.write(`Required for run/resume: --state-dir PATH --sui-binary PATH --execution-plan-id SHA256\n`);
  process.stdout.write(`After manifest seal, run/resume also requires --release-id SHA256\n`);
  process.stdout.write(`Writes require all three gates: --confirm-mainnet --allow-signing --allow-broadcast\n`);
}

async function loadSealPolicy(options) {
  if (options['seal-policy']) {
    return assertMainnetV8SealPolicyTemplate(
      JSON.parse(await fsp.readFile(path.resolve(options['seal-policy']), 'utf8')),
    );
  }
  return await buildSealPolicy({
    keyServers: [{
      objectId: MAINNET_V8_DEFAULT_COMMITTEE,
      weight: '1',
    }],
    threshold: '1',
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
  stateDir,
  suiBinary,
  sender,
  sealPolicy: sealPolicyInput,
  client = new SuiGrpcClient({ network: 'mainnet', baseUrl: MAKER_V8_SUI_GRPC_MAINNET_ENDPOINT }),
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
  const [git, toolchain, profile] = await Promise.all([
    inspectMainnetV8GitSource(repositoryRoot),
    inspectMainnetV8Toolchain({ suiBinary }),
    assertMainnetV8ProtocolProfile(client),
  ]);
  const sealPolicy = assertMainnetV8SealPolicyTemplate(sealPolicyInput);
  const checkoutRoot = path.join(stagingState, 'source');
  await archiveCleanSource({ repositoryRoot, commit: git.commit, destination: checkoutRoot });
  const publishedTomlPath = path.join(stagingState, MAINNET_V8_PUBLISHED_FILENAME);
  await fsp.writeFile(publishedTomlPath, renderPublishedToml({
    buildEnv: 'mainnet', chainId: '35834a8a', entries: [],
  }), { encoding: 'utf8', mode: 0o600 });
  const sourceArtifacts = Object.fromEntries(await Promise.all(ROLE_ORDER.map(async (role) => [
    role,
    await buildSourceArtifactForRole({ role, checkoutRoot, git, toolchain }),
  ])));
  const coreBuild = await withApprovedSuiBinarySnapshot(
    toolchain.path,
    async (snapshotPath) => buildMainnetV8Package({
      role: 'core',
      checkoutRoot,
      publishedTomlPath,
      suiBinary: snapshotPath,
      git,
      toolchain: Object.freeze({ ...toolchain, path: snapshotPath }),
      sourceArtifact: sourceArtifacts.core,
    }),
  );
  const plan = await createReleasePlan({
    sender: checkedSender,
    sourceRevision: { gitCommit: git.commit, gitTree: git.tree, clean: true },
    toolchain: {
      suiVersion: toolchain.suiVersion,
      suiVersionOutput: toolchain.suiVersionOutput,
      suiSourceCommit: toolchain.suiSourceCommit,
      suiBinarySha256: toolchain.suiBinarySha256,
      frameworkRevision: toolchain.frameworkRevision,
    },
    sealPolicy,
    packages: ROLE_ORDER.map((role) => ({
      role,
      packageName: ROLE_PACKAGE_NAMES[role],
      sourceArtifact: sourceArtifacts[role],
    })),
  });
  assertReleasePlan(plan);
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
    publishedTomlSha256: sha256Hex(await fsp.readFile(publishedTomlPath)),
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
    || canonicalJson(cold) !== canonicalJson(appended)) {
    fail('MAINNET_V8_WAL_COLD_READ_DRIFT', 'Durable WAL cold read differs after append.');
  }
  return cold;
}

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
    packageName: ROLE_PACKAGE_NAMES[readback.role],
    source: path.join(path.resolve(checkoutRoot), 'move', ROLE_PACKAGE_NAMES[readback.role]),
    publishedAt: readback.package.reference.objectId,
    originalId: readback.package.reference.objectId,
    version: '1',
    toolchainVersion: MAINNET_V8_RELEASE_TOOLCHAIN.suiVersion,
    buildConfig: Object.freeze({ flavor: 'sui', edition: '2024' }),
    upgradeCapability: readback.upgradeCap.reference.objectId,
  });
}

function publishedPrefixSnapshot(wal, checkoutRoot, completedCount = ROLE_ORDER.length) {
  if (!Number.isSafeInteger(completedCount)
    || completedCount < 0 || completedCount > ROLE_ORDER.length) {
    fail('MAINNET_V8_PUBLISHED_PREFIX_INVALID', 'Published prefix length is out of bounds.');
  }
  const entries = [];
  for (let ordinal = 0; ordinal < completedCount; ordinal += 1) {
    const success = wal.events.find((event) => event.ordinal === String(ordinal)
      && event.status === 'FINALIZED_SUCCESS');
    if (!success) break;
    entries.push(publishedEntryFromDetails(checkoutRoot, success.evidence.observation.details));
  }
  const text = renderPublishedToml({
    buildEnv: 'mainnet',
    chainId: '35834a8a',
    entries,
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
  });
  return Object.freeze({
    entries: parsed.entries,
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

async function materializePublishedPrefix(paths, wal) {
  return writePublishedPrefix(
    paths.published,
    publishedPrefixSnapshot(wal, paths.checkout),
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

export function assertMainnetV8ReadyWalContext({ wal, ordinal, readyArtifact }) {
  assertReleasePlan(wal?.plan);
  const ordinalText = decimal(String(ordinal), 'READY context ordinal');
  const ordinalNumber = Number(ordinalText);
  if (!Number.isSafeInteger(ordinalNumber) || ordinalNumber < 0 || ordinalNumber > 9
    || !plain(readyArtifact)) {
    fail('MAINNET_V8_READY_CONTEXT_DRIFT', 'READY context is malformed.');
  }
  const expectedPredecessor = predecessorForReady(wal, ordinalNumber);
  if (canonicalJson(readyArtifact.predecessorReadback) !== canonicalJson(expectedPredecessor)) {
    fail('MAINNET_V8_READY_CONTEXT_DRIFT', 'READY predecessor differs from the durable finalized head.');
  }
  if (ordinalNumber < ROLE_ORDER.length) {
    const role = ROLE_ORDER[ordinalNumber];
    const planned = wal.plan.packages[ordinalNumber];
    if (readyArtifact.kind !== 'PUBLISH' || readyArtifact.role !== role
      || readyArtifact.packageArtifact?.role !== role
      || planned.packageName !== ROLE_PACKAGE_NAMES[role]
      || canonicalJson(readyArtifact.dependencies)
        !== canonicalJson(readyArtifact.packageArtifact?.dependencies)
      || computePackageCommitment(readyArtifact.packageArtifact)
        !== readyArtifact.packageCommitment) {
      fail('MAINNET_V8_READY_CONTEXT_DRIFT', `${role} READY is not bound to its immutable plan/build artifact.`);
    }
    return readyArtifact;
  }
  if (!wal.finalManifest || wal.finalManifest.releaseId !== wal.releaseId) {
    fail('MAINNET_V8_READY_CONTEXT_DRIFT', 'Stage READY requires the exact sealed final manifest.');
  }
  const packageIds = packageIdsFromFinalManifest(wal);
  const core = finalizedDetails(wal, 0).certificate.readback;
  let expectedStageData;
  if (ordinalText === '7') {
    if (readyArtifact.kind !== 'INITIALIZE_PROTOCOL') {
      fail('MAINNET_V8_READY_CONTEXT_DRIFT', 'Ordinal 7 must be INITIALIZE_PROTOCOL.');
    }
    expectedStageData = Object.freeze({
      packageIds,
      protocolConfig: sharedReferenceFromOutput(core.protocolConfig, 'Core ProtocolConfig'),
      protocolAdminCap: ownedReferenceFromOutput(core.protocolAdminCap, 'Core ProtocolAdminCap'),
    });
  } else if (ordinalText === '8') {
    if (readyArtifact.kind !== 'BOOTSTRAP_RELEASE') {
      fail('MAINNET_V8_READY_CONTEXT_DRIFT', 'Ordinal 8 must be BOOTSTRAP_RELEASE.');
    }
    const init = finalizedDetails(wal, 7).certificate.readback;
    const finalSealPolicy = assertMainnetV8FinalSealPolicy(
      wal.finalManifest.sealPolicy,
      wal.plan.sealPolicy,
    );
    if (!Array.isArray(readyArtifact.stageData?.keyServerCertificates)
      || readyArtifact.stageData.keyServerCertificates.length !== finalSealPolicy.keyServers.length) {
      fail('MAINNET_V8_READY_CONTEXT_DRIFT', 'Bootstrap READY lacks exact Seal key-server certificates.');
    }
    readyArtifact.stageData.keyServerCertificates.forEach((certificate, index) => {
      exactKeys(certificate, [
        'objectId', 'type', 'version', 'digest', 'owner', 'previousTransaction', 'contentSha256',
      ], `keyServerCertificates[${index}]`);
      if (certificate.objectId !== finalSealPolicy.keyServers[index].objectId
        || typeof certificate.type !== 'string'
        || !/::key_server::KeyServer$/.test(certificate.type)) {
        fail('MAINNET_V8_READY_CONTEXT_DRIFT', 'Bootstrap READY key-server certificate differs from final Seal policy.');
      }
      address(certificate.owner, `keyServerCertificates[${index}].owner`);
      decimal(certificate.version, `keyServerCertificates[${index}].version`);
      digest(certificate.digest, `keyServerCertificates[${index}].digest`);
      digest(certificate.previousTransaction, `keyServerCertificates[${index}].previousTransaction`);
      hash32(certificate.contentSha256, `keyServerCertificates[${index}].contentSha256`);
    });
    const commitments = Object.freeze(Object.fromEntries(wal.finalManifest.packages.map((entry) => [
      entry.role,
      Object.freeze({
        source: entry.sourceCommitment,
        package: entry.packageCommitment,
        abi: entry.abiCommitment,
      }),
    ])));
    expectedStageData = Object.freeze({
      packageIds,
      protocolConfig: sharedReferenceFromOutput(init.protocolConfig, 'Initialized ProtocolConfig'),
      protocolAdminCap: ownedReferenceFromOutput(core.protocolAdminCap, 'Core ProtocolAdminCap'),
      commitments,
      sealPolicy: finalSealPolicy,
      keyServerCertificates: readyArtifact.stageData.keyServerCertificates,
    });
  } else {
    if (readyArtifact.kind !== 'VERIFY_AND_EXPORT') {
      fail('MAINNET_V8_READY_CONTEXT_DRIFT', 'Ordinal 9 must be VERIFY_AND_EXPORT.');
    }
    const bootstrap = finalizedDetails(wal, 8).certificate;
    expectedStageData = Object.freeze({
      releaseId: wal.releaseId,
      finalManifestSha256: mainnetV8JsonSha(wal.finalManifest),
      bootstrapCertificateSha256: bootstrap.readbackSha256,
      exportFilename: 'animacraft-mainnet-v8-config.json',
    });
  }
  if (canonicalJson(readyArtifact.stageData) !== canonicalJson(expectedStageData)
    || readyArtifact.stageDataSha256 !== mainnetV8JsonSha(expectedStageData)) {
    fail('MAINNET_V8_READY_CONTEXT_DRIFT', `Ordinal ${ordinalText} READY differs from sealed manifest/predecessor evidence.`);
  }
  return readyArtifact;
}

async function appendReadyEvent({ paths, wal, ordinal, readyArtifact, unsignedEnvelope }) {
  assertMainnetV8ReadyWalContext({ wal, ordinal, readyArtifact });
  const evidence = buildMainnetV8ReadyEvidence({
    ordinal: String(ordinal), attempt: '0', readyArtifact, unsignedEnvelope,
  });
  if (ordinal < 9) {
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
    git: Object.freeze({ commit: plan.sourceRevision.gitCommit, tree: plan.sourceRevision.gitTree }),
    toolchain: Object.freeze({ ...plan.toolchain, path: path.resolve(suiBinary) }),
  });
}

async function assertFreshCheckoutSources({ checkoutRoot, plan, identity }) {
  const observed = await Promise.all(ROLE_ORDER.map(async (role, index) => {
    const artifact = await buildSourceArtifactForRole({
      role,
      checkoutRoot,
      git: identity.git,
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

async function withFreshSourceArchive({ repositoryRoot, plan }, operation) {
  assertReleasePlan(plan);
  if (typeof operation !== 'function') {
    fail('MAINNET_V8_BUILD_OPERATION_INVALID', 'Fresh source archive requires one operation.');
  }
  const identity = Object.freeze({
    git: Object.freeze({
      commit: plan.sourceRevision.gitCommit,
      tree: plan.sourceRevision.gitTree,
    }),
    toolchain: plan.toolchain,
  });
  const observedTree = (await runProcess(
    'git',
    ['rev-parse', `${identity.git.commit}^{tree}`],
    { cwd: repositoryRoot },
  )).stdout.trim();
  if (observedTree !== identity.git.tree) {
    fail('MAINNET_V8_GIT_TREE_DRIFT', 'Approved release commit no longer resolves to its immutable tree.', {
      expected: identity.git.tree,
      observed: observedTree,
    });
  }
  const temporaryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'animacraft-mainnet-v8-build-'));
  await fsp.chmod(temporaryRoot, 0o700);
  try {
    const checkoutRoot = path.join(temporaryRoot, 'source');
    await archiveCleanSource({
      repositoryRoot,
      commit: identity.git.commit,
      destination: checkoutRoot,
    });
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

export async function inspectMainnetV8FreshSourceArchive({ repositoryRoot, plan }) {
  return withFreshSourceArchive(
    { repositoryRoot: path.resolve(repositoryRoot), plan },
    async ({ sourceArtifacts, identity }) => Object.freeze({
      git: identity.git,
      sourceCommitments: Object.freeze(Object.fromEntries(
        sourceArtifacts.map((artifact) => [artifact.role, computeSourceCommitment(artifact)]),
      )),
    }),
  );
}

async function withFreshReleaseCheckout({ repositoryRoot, wal, suiBinary }, operation) {
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
  return withFreshSourceArchive({ repositoryRoot, plan: wal.plan }, async ({
    temporaryRoot,
    checkoutRoot,
  }) => {
    const snapshotPath = await copyApprovedSuiBinary({
      source: identity.toolchain.path,
      destination: path.join(temporaryRoot, 'sui'),
    });
    const snapshotIdentity = Object.freeze({
      git: identity.git,
      toolchain: Object.freeze({ ...identity.toolchain, path: snapshotPath }),
    });
    const publishedTomlPath = path.join(temporaryRoot, MAINNET_V8_PUBLISHED_FILENAME);
    const published = publishedPrefixSnapshot(wal, checkoutRoot);
    await writePublishedPrefix(publishedTomlPath, published);
    return await operation(Object.freeze({
      checkoutRoot,
      publishedTomlPath,
      published,
      identity: snapshotIdentity,
    }));
  });
}

function expectedProductDependencies(wal, ordinal) {
  const role = ROLE_ORDER[ordinal];
  return ROLE_DEPENDENCIES[role]
    .map((dependencyRole) => finalizedDetails(wal, ROLE_ORDER.indexOf(dependencyRole))
      .certificate.readback.package.reference.objectId)
    .sort();
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
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= ROLE_ORDER.length) {
    return Object.freeze({ kind: 'NON_PUBLISH', ordinal: event.ordinal });
  }
  if (event.status !== 'READY' || event.attempt !== '0') {
    fail('MAINNET_V8_READY_BUILD_DRIFT', 'Only the canonical publish READY cursor can be rebuilt.');
  }
  const ready = event.evidence?.readyArtifact;
  const role = ROLE_ORDER[ordinal];
  if (!plain(ready) || ready.kind !== 'PUBLISH' || ready.role !== role) {
    fail('MAINNET_V8_READY_BUILD_DRIFT', `${role} READY does not contain its exact publish artifact.`);
  }
  const persistentPublished = await materializePublishedPrefix(paths, wal);
  if (ready.publishedTomlSha256 !== persistentPublished.sha256) {
    fail('MAINNET_V8_READY_BUILD_DRIFT', `${role} READY is not bound to the finalized Published.toml prefix.`);
  }
  const { build, published } = await withFreshReleaseCheckout(
    { repositoryRoot, wal, suiBinary },
    async ({ checkoutRoot, publishedTomlPath, published: freshPublished, identity }) => ({
      published: freshPublished,
      build: await buildMainnetV8Package({
        role,
        checkoutRoot,
        publishedTomlPath,
        suiBinary: identity.toolchain.path,
        git: identity.git,
        toolchain: identity.toolchain,
        sourceArtifact: wal.plan.packages[ordinal].sourceArtifact,
      }),
    }),
  );
  if (published.sha256 !== persistentPublished.sha256
    || published.sha256 !== ready.publishedTomlSha256) {
    fail('MAINNET_V8_READY_BUILD_DRIFT', `${role} clean-room Published.toml prefix differs from durable READY.`);
  }
  const expectedDependencies = expectedProductDependencies(wal, ordinal);
  const priorPackageIds = ROLE_ORDER.slice(0, ordinal).map((_, priorOrdinal) =>
    finalizedDetails(wal, priorOrdinal).certificate.readback.package.reference.objectId);
  const observedProductDependencies = priorPackageIds
    .filter((packageId) => build.dependencies.includes(packageId))
    .sort();
  if (canonicalJson(observedProductDependencies) !== canonicalJson(expectedDependencies)
    || canonicalJson(build.packageArtifact) !== canonicalJson(ready.packageArtifact)
    || computePackageCommitment(build.packageArtifact) !== ready.packageCommitment
    || canonicalJson(build.publishModules) !== canonicalJson(ready.modules)
    || canonicalJson(build.dependencies) !== canonicalJson(ready.dependencies)) {
    fail('MAINNET_V8_READY_BUILD_DRIFT', `${role} cold rebuild differs from the durable READY build seal.`, {
      expectedDependencies,
      observedProductDependencies,
    });
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
  wal,
  suiBinary,
  client,
  transport,
}) {
  assertReleasePlan(wal?.plan);
  if (!wal.finalManifest || wal.releaseId !== wal.finalManifest.releaseId) {
    fail('MAINNET_V8_FINAL_MANIFEST_REQUIRED', 'Final package verification requires the sealed manifest.');
  }
  return withFreshReleaseCheckout(
    { repositoryRoot, wal, suiBinary },
    async ({ checkoutRoot, publishedTomlPath, identity }) => {
      const packages = [];
      for (let ordinal = 0; ordinal < ROLE_ORDER.length; ordinal += 1) {
        const role = ROLE_ORDER[ordinal];
        const ready = cursorEvidence(wal, ordinal, '0', 'READY').readyArtifact;
        const details = finalizedDetails(wal, ordinal);
        const durablePackage = details.certificate.readback.package;
        const manifest = wal.finalManifest.packages[ordinal];
        const published = publishedPrefixSnapshot(wal, checkoutRoot, ordinal);
        await writePublishedPrefix(publishedTomlPath, published);
        if (ready.role !== role || ready.publishedTomlSha256 !== published.sha256) {
          fail('MAINNET_V8_FINAL_PACKAGE_DRIFT', `${role} READY is not bound to its historical Published.toml prefix.`);
        }
        const build = await buildMainnetV8Package({
          role,
          checkoutRoot,
          publishedTomlPath,
          suiBinary: identity.toolchain.path,
          git: identity.git,
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
  const role = ROLE_ORDER[ordinal];
  const persistentPublished = await materializePublishedPrefix(paths, wal);
  const { build, published } = await withFreshReleaseCheckout(
    { repositoryRoot, wal, suiBinary },
    async ({ checkoutRoot, publishedTomlPath, published: freshPublished, identity }) => ({
      published: freshPublished,
      build: await buildMainnetV8Package({
        role,
        checkoutRoot,
        publishedTomlPath,
        suiBinary: identity.toolchain.path,
        git: identity.git,
        toolchain: identity.toolchain,
        sourceArtifact: wal.plan.packages[ordinal].sourceArtifact,
      }),
    }),
  );
  if (published.sha256 !== persistentPublished.sha256) {
    fail('MAINNET_V8_BUILD_DEPENDENCY_DRIFT', `${role} clean-room Published.toml differs from durable prefix.`);
  }
  const expectedRoleDependencies = expectedProductDependencies(wal, ordinal);
  if (expectedRoleDependencies.some((dependencyId) => !build.dependencies.includes(dependencyId))) {
    fail('MAINNET_V8_BUILD_DEPENDENCY_DRIFT', `${role} build omits a finalized role dependency.`, {
      expectedRoleDependencies,
      observedDependencies: build.dependencies,
    });
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

async function prepareInitReady({ paths, wal, client }) {
  const published = await materializePublishedPrefix(paths, wal);
  const packageIds = packageIdsFromFinalManifest(wal);
  const core = finalizedDetails(wal, 0).certificate.readback;
  const protocolConfig = sharedReferenceFromOutput(core.protocolConfig, 'Core ProtocolConfig');
  const protocolAdminCap = ownedReferenceFromOutput(core.protocolAdminCap, 'Core ProtocolAdminCap');
  const stageData = Object.freeze({ packageIds, protocolConfig, protocolAdminCap });
  const profile = await assertMainnetV8ProtocolProfile(client);
  const prepared = await prepareUnsignedMainnetV8Transaction({
    client,
    profile,
    sender: wal.plan.sender,
    buildTransaction: (transactionContext) => buildMainnetV8InitTransaction({
      packageIds, protocolConfig, protocolAdminCap, transactionContext,
    }),
  });
  const readyArtifact = Object.freeze({
    kind: 'INITIALIZE_PROTOCOL',
    stageData,
    stageDataSha256: mainnetV8JsonSha(stageData),
    publishedTomlSha256: published.sha256,
    simulation: prepared.simulation,
    gasFunding: prepared.gasFunding,
    protocolProfile: profile,
    predecessorReadback: predecessorForReady(wal, 7),
  });
  return appendReadyEvent({
    paths, wal, ordinal: 7, readyArtifact, unsignedEnvelope: prepared.unsignedEnvelope,
  });
}

async function certifyMainnetV8SealKeyServers({ transport, sealPolicy }) {
  const certificates = [];
  for (const server of sealPolicy.keyServers) {
    if (server.objectId !== MAINNET_V8_DEFAULT_COMMITTEE) {
      fail('MAINNET_V8_SEAL_KEY_SERVER_NOT_APPROVED', 'This Mainnet release only approves the reviewed Mysten decentralized committee.', {
        expected: MAINNET_V8_DEFAULT_COMMITTEE,
        observed: server.objectId,
      });
    }
    const response = await transport.getObject({
      id: server.objectId,
      options: { showContent: true, showBcs: true, showOwner: true },
    });
    const data = response?.data;
    if (!data || data.objectId !== server.objectId
      || data.type !== MAINNET_V8_DEFAULT_COMMITTEE_TYPE
      || data.content?.dataType !== 'moveObject'
      || data.content?.type !== MAINNET_V8_DEFAULT_COMMITTEE_TYPE
      || data.bcs?.dataType !== 'moveObject'
      || data.bcs?.type !== MAINNET_V8_DEFAULT_COMMITTEE_TYPE
      || String(data.bcs?.version) !== String(data.version)
      || !plain(data.owner)
      || data.owner.ObjectOwner !== MAINNET_V8_DEFAULT_COMMITTEE_OWNER) {
      fail('MAINNET_V8_SEAL_KEY_SERVER_INVALID', 'Seal key server is absent or has an unapproved Mainnet shape.', {
        objectId: server.objectId,
      });
    }
    const objectBytes = fromBase64(data.bcs.bcsBytes);
    const parsed = SEAL_KEY_SERVER_OBJECT_BCS.parse(objectBytes);
    const roundtrip = SEAL_KEY_SERVER_OBJECT_BCS.serialize(parsed).toBytes();
    if (!sameBytes(objectBytes, roundtrip)
      || address(parsed.id, 'Seal key server BCS id') !== server.objectId
      || decimal(String(parsed.first_version), 'Seal key server first_version') !== '2'
      || decimal(String(parsed.last_version), 'Seal key server last_version') !== '2'
      || canonicalJson(data.content.fields) !== canonicalJson({
        id: server.objectId,
        first_version: '2',
        last_version: '2',
      })
      || sha256Hex(objectBytes) !== MAINNET_V8_DEFAULT_COMMITTEE_CONTENT_SHA256) {
      fail('MAINNET_V8_SEAL_KEY_SERVER_INVALID', 'Seal key server raw BCS differs from the reviewed Mainnet committee snapshot.', {
        objectId: server.objectId,
      });
    }
    certificates.push(Object.freeze({
      objectId: server.objectId,
      type: data.type,
      version: decimal(String(data.version), 'Seal key server version'),
      digest: digest(data.digest, 'Seal key server digest'),
      owner: address(data.owner.ObjectOwner, 'Seal key server owner'),
      previousTransaction: digest(data.previousTransaction, 'Seal key server previousTransaction'),
      contentSha256: sha256Hex(objectBytes),
    }));
  }
  return Object.freeze(certificates);
}

async function rereadExactMoveOutput(transport, output, label) {
  const observed = await readExactMainnetV8MoveOutput({
    transport,
    reference: Object.freeze({ ...output.reference, owner: output.owner }),
    transactionDigest: output.previousTransaction,
  });
  if (canonicalJson(observed) !== canonicalJson(output)) {
    fail('MAINNET_V8_STAGE_AUTHORITY_DRIFT', `${label} changed after READY was durably frozen.`);
  }
  return observed;
}

export async function assertMainnetV8StageReadyAuthority({ wal, event, transport }) {
  const ordinal = Number(decimal(event.ordinal, 'stage authority ordinal'));
  if (ordinal < ROLE_ORDER.length || ordinal > 8) {
    return Object.freeze({ kind: 'NO_STAGE_AUTHORITY', ordinal: event.ordinal });
  }
  if (event.status !== 'READY' || event.attempt !== '0') {
    fail('MAINNET_V8_STAGE_AUTHORITY_DRIFT', 'Stage authority can only be checked at canonical READY.');
  }
  const core = finalizedDetails(wal, 0).certificate.readback;
  if (ordinal === 7) {
    await Promise.all([
      rereadExactMoveOutput(transport, core.protocolConfig, 'Core ProtocolConfig'),
      rereadExactMoveOutput(transport, core.protocolAdminCap, 'Core ProtocolAdminCap'),
    ]);
    return Object.freeze({
      kind: 'INITIALIZE_AUTHORITY_VERIFIED',
      protocolConfigSha256: mainnetV8JsonSha(core.protocolConfig),
      protocolAdminCapSha256: mainnetV8JsonSha(core.protocolAdminCap),
    });
  }
  const initialized = finalizedDetails(wal, 7).certificate.readback;
  const finalSealPolicy = assertMainnetV8FinalSealPolicy(
    wal.finalManifest?.sealPolicy,
    wal.plan.sealPolicy,
  );
  const [protocolConfig, protocolAdminCap, keyServerCertificates] = await Promise.all([
    rereadExactMoveOutput(transport, initialized.protocolConfig, 'Initialized ProtocolConfig'),
    rereadExactMoveOutput(transport, core.protocolAdminCap, 'Core ProtocolAdminCap'),
    certifyMainnetV8SealKeyServers({ transport, sealPolicy: finalSealPolicy }),
  ]);
  const expectedCertificates = event.evidence.readyArtifact.stageData.keyServerCertificates;
  if (canonicalJson(keyServerCertificates) !== canonicalJson(expectedCertificates)) {
    fail('MAINNET_V8_STAGE_AUTHORITY_DRIFT', 'Seal key-server snapshot changed after bootstrap READY.');
  }
  return Object.freeze({
    kind: 'BOOTSTRAP_AUTHORITY_VERIFIED',
    protocolConfigSha256: mainnetV8JsonSha(protocolConfig),
    protocolAdminCapSha256: mainnetV8JsonSha(protocolAdminCap),
    keyServerCertificatesSha256: mainnetV8JsonSha(keyServerCertificates),
  });
}

async function prepareBootstrapReady({ paths, wal, client, transport }) {
  const published = await materializePublishedPrefix(paths, wal);
  const packageIds = packageIdsFromFinalManifest(wal);
  const core = finalizedDetails(wal, 0).certificate.readback;
  const init = finalizedDetails(wal, 7).certificate.readback;
  const protocolConfig = sharedReferenceFromOutput(init.protocolConfig, 'Initialized ProtocolConfig');
  const protocolAdminCap = ownedReferenceFromOutput(core.protocolAdminCap, 'Core ProtocolAdminCap');
  const commitments = Object.freeze(Object.fromEntries(wal.finalManifest.packages.map((entry) => [
    entry.role,
    Object.freeze({
      source: entry.sourceCommitment,
      package: entry.packageCommitment,
      abi: entry.abiCommitment,
    }),
  ])));
  const finalSealPolicy = assertMainnetV8FinalSealPolicy(
    wal.finalManifest.sealPolicy,
    wal.plan.sealPolicy,
  );
  const keyServerCertificates = await certifyMainnetV8SealKeyServers({
    transport, sealPolicy: finalSealPolicy,
  });
  const stageData = Object.freeze({
    packageIds,
    protocolConfig,
    protocolAdminCap,
    commitments,
    sealPolicy: finalSealPolicy,
    keyServerCertificates,
  });
  const profile = await assertMainnetV8ProtocolProfile(client);
  const prepared = await prepareUnsignedMainnetV8Transaction({
    client,
    profile,
    sender: wal.plan.sender,
    buildTransaction: (transactionContext) => buildMainnetV8BootstrapTransaction({
      packageIds, protocolConfig, protocolAdminCap, commitments,
      sealPolicy: finalSealPolicy, transactionContext,
    }),
  });
  const readyArtifact = Object.freeze({
    kind: 'BOOTSTRAP_RELEASE',
    stageData,
    stageDataSha256: mainnetV8JsonSha(stageData),
    publishedTomlSha256: published.sha256,
    simulation: prepared.simulation,
    gasFunding: prepared.gasFunding,
    protocolProfile: profile,
    predecessorReadback: predecessorForReady(wal, 8),
  });
  return appendReadyEvent({
    paths, wal, ordinal: 8, readyArtifact, unsignedEnvelope: prepared.unsignedEnvelope,
  });
}

async function prepareVerifyReady({ paths, wal, client }) {
  const published = await materializePublishedPrefix(paths, wal);
  const bootstrapDetails = finalizedDetails(wal, 8);
  const stageData = Object.freeze({
    releaseId: wal.releaseId,
    finalManifestSha256: mainnetV8JsonSha(wal.finalManifest),
    bootstrapCertificateSha256: bootstrapDetails.certificate.readbackSha256,
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
    predecessorReadback: predecessorForReady(wal, 9),
  });
  return appendReadyEvent({
    paths, wal, ordinal: 9, readyArtifact, unsignedEnvelope: null,
  });
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
  const bootstrapDetails = finalizedDetails(wal, 8);
  const bootstrap = bootstrapDetails.certificate.readback;
  const packageVerification = await operations.verifyFinalPackages({
    repositoryRoot,
    wal,
    suiBinary,
    client,
    transport,
  });
  const attested = await attestMakerV8Runtime(transport, bootstrap.runtimeConfig, { network: 'mainnet' });
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
  const exportedConfig = Object.freeze({
    schemaVersion: MAINNET_V8_RELEASE_RUNNER_SCHEMA,
    kind: 'ANIMACRAFT_MAINNET_V8_CONFIG',
    executionPlanId: wal.executionPlanId,
    releaseId: wal.releaseId,
    runtimeConfig: bootstrap.runtimeConfig,
    packageIds,
    finalManifest: wal.finalManifest,
    packageVerification,
    protectedDecryptionReady: false,
    protectedDecryptionBlocker: Object.freeze({
      code: 'ENOKI_SEAL_API_KEY_REQUIRED',
      aggregator: MAINNET_V8_DEFAULT_AGGREGATOR,
      secretStoredInArtifact: false,
    }),
  });
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
    runtimeAttestationSha256: mainnetV8JsonSha(canonicalizeSdk({
      catalog: attested.catalog,
      configs: attested.configs,
      packageTuple: attested.packageTuple,
      coreArtifact: attested.coreArtifact,
    })),
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
  const details = Number(event.ordinal) < ROLE_ORDER.length
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
  return /(?:UNAVAILABLE|TIMEOUT|DEADLINE|NOT_FOUND|PRUNED|ARCHIVAL|NETWORK|RPC)/.test(code);
}

async function certifyOrdinalReadback({ ordinal, wal, ready, client, transport, finalityEvidence }) {
  if (ordinal < ROLE_ORDER.length) {
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
      role: ROLE_ORDER[ordinal],
      build,
      finalityEvidence,
      signer: wal.plan.sender,
    });
  }
  if (ordinal === 7) {
    const packageIds = packageIdsFromFinalManifest(wal);
    const core = finalizedDetails(wal, 0).certificate.readback;
    return certifyMainnetV8ProtocolInit({
      transport,
      packageIds,
      protocolConfigId: core.protocolConfig.reference.objectId,
      signer: wal.plan.sender,
      finalityEvidence,
    });
  }
  if (ordinal === 8) {
    const packageIds = packageIdsFromFinalManifest(wal);
    const packageCommitments = Object.freeze(Object.fromEntries(
      wal.finalManifest.packages.map((entry) => [entry.role, Object.freeze({
        source: entry.sourceCommitment,
        package: entry.packageCommitment,
        abi: entry.abiCommitment,
      })]),
    ));
    return certifyMainnetV8Bootstrap({
      transport,
      packageIds,
      packageCommitments,
      initCertificate: finalizedDetails(wal, 7).certificate.readback,
      sealPolicy: assertMainnetV8FinalSealPolicy(
        wal.finalManifest.sealPolicy,
        wal.plan.sealPolicy,
      ),
      signer: wal.plan.sender,
      finalityEvidence,
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
  const details = ordinal < ROLE_ORDER.length
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

function finalManifestFromWal(wal) {
  const packages = ROLE_ORDER.map((role, ordinal) => {
    const details = finalizedDetails(wal, ordinal);
    const certificate = details.certificate;
    const readback = certificate.readback;
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
  });
  return buildFinalManifest({ plan: wal.plan, packages });
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
  const evidence = buildMainnetV8ManifestEvidence({
    ordinal: '6', attempt: '0', finalManifest, plan: wal.plan,
  });
  return appendAndColdRead(paths, wal, {
    ordinal: '6', attempt: '0', status: 'FINAL_MANIFEST_SEALED', evidence,
  });
}

function releaseCertificateFromWal(wal) {
  const event = headEvent(wal);
  if (event.ordinal !== '9' || event.status !== 'FINALIZED_SUCCESS'
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
    packagePublishes: Object.freeze(ROLE_ORDER.map((role, ordinal) => Object.freeze({
      role,
      finalized: finalizedDetails(wal, ordinal),
    }))),
    protocolInitialization: finalizedDetails(wal, 7),
    bootstrap: finalizedDetails(wal, 8),
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
    ordinal: '9',
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
    ordinal: '9', attempt: event.attempt, status: 'FINALIZED_SUCCESS', evidence,
  });
  await ensureReleaseCertificate(paths, complete);
  return complete;
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
        'A releaseId cannot be approved before the seven-package final manifest is sealed.',
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
  const toolchain = await operations.inspectToolchain({ suiBinary });
  if (toolchain.suiVersion !== wal.plan.toolchain.suiVersion
    || toolchain.suiVersionOutput !== wal.plan.toolchain.suiVersionOutput
    || toolchain.suiSourceCommit !== wal.plan.toolchain.suiSourceCommit
    || toolchain.suiBinarySha256 !== wal.plan.toolchain.suiBinarySha256
    || toolchain.frameworkRevision !== wal.plan.toolchain.frameworkRevision) {
    fail('MAINNET_V8_TOOLCHAIN_DRIFT', 'Resume toolchain differs from the immutable release plan.');
  }
  for (let transition = 0; transition < maximumTransitions; transition += 1) {
    const event = headEvent(wal);
    const ordinal = Number(event.ordinal);
    if (['FINALIZED_FAILURE', 'EXPIRED_NOT_FOUND', 'INCIDENT_STOPPED'].includes(event.status)) {
      return Object.freeze({ status: event.status, wal, writesComplete: false });
    }
    if (event.status === 'READY') {
      if (ordinal === 9) {
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
      continue;
    }
    if (event.status === 'FINALIZED_SUCCESS') {
      if (ordinal < 6) {
        wal = await preparePublishReady({
          paths,
          wal,
          ordinal: ordinal + 1,
          suiBinary,
          client,
          repositoryRoot,
        });
      } else if (ordinal === 6) {
        wal = await sealFinalManifest({ paths, wal });
        return Object.freeze({
          status: 'FINAL_MANIFEST_REVIEW_REQUIRED',
          wal,
          writesComplete: false,
        });
      } else if (ordinal === 7) {
        wal = await prepareBootstrapReady({ paths, wal, client, transport });
      } else if (ordinal === 8) {
        wal = await prepareVerifyReady({ paths, wal, client });
      } else if (ordinal === 9) {
        await ensureReleaseCertificate(paths, wal);
        return Object.freeze({ status: 'CHAIN_RELEASE_COMPLETE', wal, writesComplete: true });
      }
      continue;
    }
    if (event.status === 'FINAL_MANIFEST_SEALED') {
      wal = await prepareInitReady({ paths, wal, client });
      continue;
    }
    fail('MAINNET_V8_WAL_STATE_UNHANDLED', `Unhandled durable state ${event.status}.`);
  }
  return Object.freeze({ status: 'TRANSITION_LIMIT_REACHED', wal, writesComplete: false });
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
      'FINAL_MANIFEST_REVIEW_REQUIRED',
    ].includes(result.status)) process.exitCode = 2;
    return;
  }
  if (command === 'verify') {
    const wal = await readReleaseWal({ path: path.join(stateDir, MAINNET_V8_WAL_FILENAME) });
    const complete = headEvent(wal).status === 'FINALIZED_SUCCESS'
      && headEvent(wal).ordinal === '9';
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
    const content = await fsp.readFile(path.join(stateDir, 'animacraft-mainnet-v8-config.json'), 'utf8');
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
