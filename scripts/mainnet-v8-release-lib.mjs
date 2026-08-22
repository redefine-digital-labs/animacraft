import { createHash, randomBytes } from 'node:crypto';
import {
  mkdir, open, readFile, rename, unlink,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

export const MAINNET_V8_RELEASE_PLAN_SCHEMA = 'animacraft.mainnet-v8-release-plan.v1';
export const MAINNET_V8_RELEASE_WAL_SCHEMA = 'animacraft.mainnet-v8-release-wal.v1';
export const MAINNET_V8_SEAL_POLICY_SCHEMA = 'animacraft.mainnet-v8-seal-policy.v1';
export const MAINNET_V8_SOURCE_ARTIFACT_DOMAIN = 'animacraft-v8/source-artifact/v1';
export const MAINNET_V8_PACKAGE_ARTIFACT_DOMAIN = 'animacraft-v8/package-artifact/v1';
export const MAINNET_V8_ABI_ARTIFACT_DOMAIN = 'animacraft-v8/abi-artifact/v1';
export const MAINNET_V8_KEY_SERVER_SET_DOMAIN = 'animacraft-v8/seal-key-server-set/v1';
export const MAINNET_V8_ENCRYPTION_POLICY_DOMAIN = 'animacraft-v8/seal-encryption-policy/v1';

export const MAINNET_V8_CHAIN_IDENTIFIER = '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S';
export const MAINNET_V8_LEGACY_CHAIN_IDENTIFIER = '35834a8a';
export const MAINNET_V8_PAYMENT_COIN_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
export const MAINNET_V8_PROTOCOL_PROFILE = Object.freeze({
  protocolVersion: '133',
  objectRuntimeMaxNumCachedObjects: '1000',
  objectRuntimeMaxNumStoreEntries: '1000',
});

export const MAINNET_V8_ROLE_ORDER = Object.freeze([
  'core', 'seal', 'runtime', 'output', 'physical', 'market', 'release',
]);

export const MAINNET_V8_ROLE_DEPENDENCIES = Object.freeze({
  core: Object.freeze([]),
  seal: Object.freeze(['core']),
  runtime: Object.freeze(['core', 'seal']),
  output: Object.freeze(['core', 'seal', 'runtime']),
  physical: Object.freeze(['core', 'output', 'runtime']),
  market: Object.freeze(['core', 'output', 'physical', 'runtime']),
  release: Object.freeze(['core', 'seal', 'runtime', 'output', 'physical']),
});

export const MAINNET_V8_PACKAGE_NAMES = Object.freeze(Object.fromEntries(
  MAINNET_V8_ROLE_ORDER.map((role) => [role, `animacraft_v8_${role}`]),
));

export const MAINNET_V8_RELEASE_STEPS = Object.freeze([
  ...MAINNET_V8_ROLE_ORDER.map((role, ordinal) => Object.freeze({
    ordinal: String(ordinal), kind: 'PUBLISH', role,
  })),
  Object.freeze({ ordinal: '7', kind: 'INITIALIZE_PROTOCOL', role: 'core' }),
  Object.freeze({ ordinal: '8', kind: 'BOOTSTRAP_RELEASE', role: 'release' }),
  Object.freeze({ ordinal: '9', kind: 'VERIFY_AND_EXPORT', role: null }),
]);

export const MAINNET_V8_WAL_STATUSES = Object.freeze([
  'READY', 'SIGNED', 'OUTCOME_PENDING', 'FINALIZED',
]);

export const MAINNET_V8_SEAL_APPROVALS = Object.freeze([
  Object.freeze({ scope: 'BASE', module: 'seal_v8', function: 'seal_approve_base_v8' }),
  Object.freeze({ scope: 'PACK', module: 'seal_v8', function: 'seal_approve_pack_v8' }),
  Object.freeze({ scope: 'COMPLETE', module: 'seal_v8', function: 'seal_approve_complete_v8' }),
]);

const HASH = /^[0-9a-f]{64}$/;
const FULL_ID = /^0x[0-9a-f]{64}$/;
const GIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const MODULE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RELEASE_ROLE = new Set(MAINNET_V8_ROLE_ORDER);
const MAX_JSON_NODES = 200_000;
const MAX_JSON_DEPTH = 128;
const MAX_CANONICAL_BYTES = 128 * 1024 * 1024;
const ZERO_HASH = '0'.repeat(64);
const encoder = new TextEncoder();

const SOURCE_FIELDS = Object.freeze([
  'domain', 'role', 'packageName', 'release', 'toolchain', 'files',
]);
const SOURCE_RELEASE_FIELDS = Object.freeze(['gitCommit', 'gitTree']);
const TOOLCHAIN_FIELDS = Object.freeze(['suiVersion', 'suiBinarySha256', 'frameworkRevision']);
const SOURCE_FILE_FIELDS = Object.freeze(['path', 'byteLength', 'sha256']);
const PACKAGE_FIELDS = Object.freeze(['domain', 'role', 'modules', 'dependencies', 'buildDigest']);
const PACKAGE_MODULE_FIELDS = Object.freeze(['name', 'bytesBase64', 'byteLength', 'sha256']);
const ABI_FIELDS = Object.freeze(['domain', 'role', 'modules']);
const ABI_MODULE_FIELDS = Object.freeze(['name', 'datatypes', 'functions']);
const SEAL_POLICY_FIELDS = Object.freeze([
  'schemaVersion', 'keyServers', 'threshold', 'keyServerSetArtifact',
  'keyServerSetCommitment', 'encryptionPolicyArtifact', 'encryptionPolicyCommitment',
]);
const KEY_SERVER_FIELDS = Object.freeze(['objectId', 'weight']);
const KEY_SERVER_SET_FIELDS = Object.freeze(['domain', 'keyServers', 'threshold']);
const ENCRYPTION_FIELDS = Object.freeze([
  'domain', 'network', 'protocolVersion', 'packageRole', 'approvals',
  'keyServerSetCommitment',
]);
const APPROVAL_FIELDS = Object.freeze(['scope', 'module', 'function']);
const PLAN_FIELDS = Object.freeze([
  'schemaVersion', 'chain', 'sender', 'sourceRevision', 'toolchain',
  'protocolProfile', 'paymentCoinType', 'sealPolicy', 'packages', 'steps', 'releaseId',
]);
const CHAIN_FIELDS = Object.freeze(['network', 'chainIdentifier', 'legacyChainIdentifier']);
const SOURCE_REVISION_FIELDS = Object.freeze(['gitCommit', 'gitTree', 'clean']);
const PLAN_PACKAGE_FIELDS = Object.freeze([
  'role', 'packageName', 'sourceArtifact', 'sourceCommitment',
  'packageArtifact', 'packageCommitment',
]);
const STEP_FIELDS = Object.freeze(['ordinal', 'kind', 'role']);
const WAL_FIELDS = Object.freeze([
  'schemaVersion', 'releaseId', 'plan', 'revision', 'headEventSha256', 'events', 'walSha256',
]);
const WAL_EVENT_FIELDS = Object.freeze([
  'revision', 'ordinal', 'status', 'evidence', 'recordedAt',
  'previousEventSha256', 'eventSha256',
]);

const ABI_STRIPPED_KEYS = new Set([
  'doc', 'docs', 'documentation', 'source', 'sourcemap', 'sourcefile',
  'sourcefiles', 'sourcelocation', 'sourcelocations', 'location', 'locations',
  'file', 'filename', 'line', 'column', 'span', 'start', 'end',
]);

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

function isPlain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactFields(value, expected, label) {
  if (!isPlain(value)) fail('MAINNET_V8_RECORD_INVALID', `${label} must be a plain record.`);
  const actual = Object.keys(value).sort(compareMainnetV8Text);
  const fields = [...expected].sort(compareMainnetV8Text);
  if (actual.length !== fields.length
    || actual.some((field, index) => field !== fields[index])) {
    fail('MAINNET_V8_FIELDS_INVALID', `${label} has fields outside its exact schema.`, {
      actual, expected: fields,
    });
  }
  return value;
}

function boundedText(value, label, maximum = 4096, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)
    || encoder.encode(value).length > maximum) {
    fail('MAINNET_V8_TEXT_INVALID', `${label} must be bounded UTF-8 text.`);
  }
  return value;
}

export function compareMainnetV8Text(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function assertMainnetV8DeterministicJson(value, label = 'Value') {
  const seen = new WeakSet();
  let nodes = 0;
  const visit = (entry, path, depth) => {
    nodes += 1;
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
      fail('MAINNET_V8_JSON_DOMAIN_INVALID', `${label} exceeds the deterministic JSON budget.`, { path });
    }
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return;
    if (typeof entry === 'number') {
      if (!Number.isSafeInteger(entry) || Object.is(entry, -0)) {
        fail('MAINNET_V8_JSON_DOMAIN_INVALID', `${label} contains a non-canonical number.`, { path });
      }
      return;
    }
    if (typeof entry !== 'object') {
      fail('MAINNET_V8_JSON_DOMAIN_INVALID', `${label} contains a non-JSON value.`, { path });
    }
    if (seen.has(entry)) fail('MAINNET_V8_JSON_DOMAIN_INVALID', `${label} contains a cycle.`, { path });
    seen.add(entry);
    const descriptors = Object.getOwnPropertyDescriptors(entry);
    if (Array.isArray(entry)) {
      if (Object.getPrototypeOf(entry) !== Array.prototype
        || Object.getOwnPropertySymbols(entry).length > 0) {
        fail('MAINNET_V8_JSON_DOMAIN_INVALID', `${label} contains a non-plain array.`, { path });
      }
      const keys = Object.keys(entry);
      const ownKeys = Reflect.ownKeys(entry);
      if (keys.length !== entry.length || keys.some((key, index) => key !== String(index))
        || ownKeys.length !== entry.length + 1 || ownKeys.at(-1) !== 'length') {
        fail('MAINNET_V8_JSON_DOMAIN_INVALID', `${label} contains a sparse or decorated array.`, { path });
      }
      for (let index = 0; index < entry.length; index += 1) {
        const descriptor = descriptors[index];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          fail('MAINNET_V8_JSON_DOMAIN_INVALID', `${label} contains an array accessor.`, { path: `${path}[${index}]` });
        }
        visit(descriptor.value, `${path}[${index}]`, depth + 1);
      }
    } else {
      if (!isPlain(entry) || Object.getOwnPropertySymbols(entry).length > 0) {
        fail('MAINNET_V8_JSON_DOMAIN_INVALID', `${label} contains a non-plain record.`, { path });
      }
      const keys = Object.keys(entry);
      if (Reflect.ownKeys(entry).length !== keys.length) {
        fail('MAINNET_V8_JSON_DOMAIN_INVALID', `${label} contains hidden record data.`, { path });
      }
      for (const key of keys) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          fail('MAINNET_V8_JSON_DOMAIN_INVALID', `${label} contains a record accessor.`, { path: `${path}.${key}` });
        }
        visit(descriptor.value, `${path}.${key}`, depth + 1);
      }
    }
    seen.delete(entry);
  };
  visit(value, '$', 0);
  return value;
}

function canonicalJsonUnchecked(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJsonUnchecked).join(',')}]`;
  return `{${Object.keys(value).sort(compareMainnetV8Text)
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonUnchecked(value[key])}`).join(',')}}`;
}

export function canonicalMainnetV8Json(value) {
  assertMainnetV8DeterministicJson(value, 'Canonical JSON value');
  const canonical = canonicalJsonUnchecked(value);
  if (encoder.encode(canonical).length > MAX_CANONICAL_BYTES) {
    fail('MAINNET_V8_CANONICAL_BYTES_EXCEEDED', 'Canonical JSON exceeds its byte budget.');
  }
  return canonical;
}

function asBytes(value, label = 'Bytes') {
  if (typeof value === 'string') return encoder.encode(value);
  if (value instanceof Uint8Array) return new Uint8Array(value);
  fail('MAINNET_V8_BYTES_INVALID', `${label} must be UTF-8 text or Uint8Array.`);
}

export function sha256MainnetV8Bytes(value) {
  return createHash('sha256').update(asBytes(value)).digest('hex');
}

export function sha256MainnetV8Json(value) {
  return sha256MainnetV8Bytes(canonicalMainnetV8Json(value));
}

export function assertMainnetV8Decimal(value, label = 'Decimal', options = {}) {
  const { positive = false, maximum = null } = options;
  if (typeof value !== 'string' || !DECIMAL.test(value)) {
    fail('MAINNET_V8_DECIMAL_INVALID', `${label} must be a canonical decimal string.`);
  }
  const parsed = BigInt(value);
  if ((positive && parsed === 0n) || (maximum !== null && parsed > BigInt(maximum))) {
    fail('MAINNET_V8_DECIMAL_INVALID', `${label} is outside its allowed range.`, { value });
  }
  return parsed;
}

function decimalInput(value, label, options) {
  if (typeof value === 'bigint') value = value.toString();
  if (typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0)) value = String(value);
  assertMainnetV8Decimal(value, label, options);
  return value;
}

export function normalizeMainnetV8ObjectId(value, label = 'Sui object ID') {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) {
    fail('MAINNET_V8_OBJECT_ID_INVALID', `${label} must be a Sui object ID.`);
  }
  return `0x${value.slice(2).toLowerCase().padStart(64, '0')}`;
}

function assertFullId(value, label) {
  if (!FULL_ID.test(value) || value === `0x${ZERO_HASH}`) {
    fail('MAINNET_V8_OBJECT_ID_INVALID', `${label} must be one nonzero canonical 32-byte Sui ID.`);
  }
  return value;
}

function assertHash(value, label) {
  if (!HASH.test(value)) fail('MAINNET_V8_HASH_INVALID', `${label} must be a lowercase SHA-256 digest.`);
  return value;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const entry of Object.values(value)) deepFreeze(entry, seen);
  return Object.freeze(value);
}

function cloneJson(value) {
  assertMainnetV8DeterministicJson(value);
  return JSON.parse(canonicalJsonUnchecked(value));
}

function decodeCanonicalBase64(value, label) {
  boundedText(value, label, 16 * 1024 * 1024);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    fail('MAINNET_V8_BASE64_INVALID', `${label} is not canonical Base64.`);
  }
  const bytes = new Uint8Array(Buffer.from(value, 'base64'));
  if (Buffer.from(bytes).toString('base64') !== value) {
    fail('MAINNET_V8_BASE64_INVALID', `${label} is not canonical Base64.`);
  }
  return bytes;
}

function assertRole(role, label = 'role') {
  if (!RELEASE_ROLE.has(role)) fail('MAINNET_V8_ROLE_INVALID', `${label} is not one v8 package role.`);
  return role;
}

function assertPackageName(role, packageName, label = 'packageName') {
  if (packageName !== MAINNET_V8_PACKAGE_NAMES[role]) {
    fail('MAINNET_V8_PACKAGE_NAME_INVALID', `${label} does not match its exact role.`, { role, packageName });
  }
  return packageName;
}

function assertGitId(value, label) {
  if (!GIT_ID.test(value)) fail('MAINNET_V8_GIT_ID_INVALID', `${label} must be a lowercase Git object ID.`);
  return value;
}

function assertToolchain(toolchain, label = 'toolchain') {
  exactFields(toolchain, TOOLCHAIN_FIELDS, label);
  boundedText(toolchain.suiVersion, `${label}.suiVersion`, 256);
  assertHash(toolchain.suiBinarySha256, `${label}.suiBinarySha256`);
  assertGitId(toolchain.frameworkRevision, `${label}.frameworkRevision`);
  return toolchain;
}

function assertSourcePath(value, label) {
  boundedText(value, label, 4096);
  if (value.includes('\\') || value.startsWith('/') || value.split('/').some((part) => !part || part === '.' || part === '..')
    || !['Move.toml', 'Move.lock'].includes(value)
      && !/^sources\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z_][A-Za-z0-9_]*\.move$/.test(value)) {
    fail('MAINNET_V8_SOURCE_PATH_INVALID', `${label} is outside the exact Move source artifact set.`, { value });
  }
  return value;
}

export function mainnetV8SourceFileRecord(path, bytes) {
  assertSourcePath(path, 'Source file path');
  const content = asBytes(bytes, `Source file ${path}`);
  return deepFreeze({
    path,
    byteLength: String(content.length),
    sha256: sha256MainnetV8Bytes(content),
  });
}

export function assertMainnetV8SourceArtifact(artifact) {
  assertMainnetV8DeterministicJson(artifact, 'Source artifact');
  exactFields(artifact, SOURCE_FIELDS, 'Source artifact');
  if (artifact.domain !== MAINNET_V8_SOURCE_ARTIFACT_DOMAIN) {
    fail('MAINNET_V8_SOURCE_ARTIFACT_INVALID', 'Source artifact domain is invalid.');
  }
  assertRole(artifact.role, 'Source artifact role');
  assertPackageName(artifact.role, artifact.packageName, 'Source artifact packageName');
  exactFields(artifact.release, SOURCE_RELEASE_FIELDS, 'Source artifact release');
  assertGitId(artifact.release.gitCommit, 'Source artifact release.gitCommit');
  assertGitId(artifact.release.gitTree, 'Source artifact release.gitTree');
  assertToolchain(artifact.toolchain, 'Source artifact toolchain');
  if (!Array.isArray(artifact.files) || artifact.files.length < 3) {
    fail('MAINNET_V8_SOURCE_ARTIFACT_INVALID', 'Source artifact must contain Move.toml, Move.lock, and Move sources.');
  }
  const paths = new Set();
  artifact.files.forEach((file, index) => {
    exactFields(file, SOURCE_FILE_FIELDS, `Source artifact files[${index}]`);
    assertSourcePath(file.path, `Source artifact files[${index}].path`);
    assertMainnetV8Decimal(file.byteLength, `Source artifact files[${index}].byteLength`);
    assertHash(file.sha256, `Source artifact files[${index}].sha256`);
    if (paths.has(file.path)) fail('MAINNET_V8_SOURCE_ARTIFACT_INVALID', 'Source artifact contains a duplicate path.', { path: file.path });
    paths.add(file.path);
    if (index > 0 && compareMainnetV8Text(artifact.files[index - 1].path, file.path) >= 0) {
      fail('MAINNET_V8_SOURCE_ARTIFACT_INVALID', 'Source artifact files are not strictly protocol-sorted.');
    }
  });
  if (!paths.has('Move.toml') || !paths.has('Move.lock')
    || !artifact.files.some(({ path }) => path.startsWith('sources/'))) {
    fail('MAINNET_V8_SOURCE_ARTIFACT_INVALID', 'Source artifact omits required Move sources.');
  }
  return artifact;
}

export function buildMainnetV8SourceArtifact(input) {
  const role = assertRole(input?.role);
  const artifact = {
    domain: MAINNET_V8_SOURCE_ARTIFACT_DOMAIN,
    role,
    packageName: input.packageName ?? MAINNET_V8_PACKAGE_NAMES[role],
    release: cloneJson(input.release),
    toolchain: cloneJson(input.toolchain),
    files: input.files.map((file) => cloneJson(file)).sort((left, right) => compareMainnetV8Text(left.path, right.path)),
  };
  assertMainnetV8SourceArtifact(artifact);
  return deepFreeze(artifact);
}

export function mainnetV8SourceCommitment(artifact) {
  assertMainnetV8SourceArtifact(artifact);
  return sha256MainnetV8Json(artifact);
}

export function mainnetV8PackageModuleRecord(name, bytes) {
  if (!MODULE_NAME.test(name)) fail('MAINNET_V8_MODULE_NAME_INVALID', 'Move module name is invalid.', { name });
  const content = typeof bytes === 'string'
    ? decodeCanonicalBase64(bytes, `Module ${name} bytes`)
    : asBytes(bytes, `Module ${name} bytes`);
  if (content.length === 0) fail('MAINNET_V8_PACKAGE_ARTIFACT_INVALID', 'Move module bytes cannot be empty.', { name });
  return deepFreeze({
    name,
    bytesBase64: Buffer.from(content).toString('base64'),
    byteLength: String(content.length),
    sha256: sha256MainnetV8Bytes(content),
  });
}

function normalizeBuildDigest(value) {
  if (Array.isArray(value) || value instanceof Uint8Array) {
    const bytes = Uint8Array.from(value);
    if (bytes.length !== 32) fail('MAINNET_V8_BUILD_DIGEST_INVALID', 'Build digest must be exactly 32 bytes.');
    return Buffer.from(bytes).toString('hex');
  }
  if (!HASH.test(value)) fail('MAINNET_V8_BUILD_DIGEST_INVALID', 'Build digest must be lowercase 32-byte hex.');
  return value;
}

export function assertMainnetV8PackageArtifact(artifact) {
  assertMainnetV8DeterministicJson(artifact, 'Package artifact');
  exactFields(artifact, PACKAGE_FIELDS, 'Package artifact');
  if (artifact.domain !== MAINNET_V8_PACKAGE_ARTIFACT_DOMAIN) {
    fail('MAINNET_V8_PACKAGE_ARTIFACT_INVALID', 'Package artifact domain is invalid.');
  }
  assertRole(artifact.role, 'Package artifact role');
  if (!Array.isArray(artifact.modules) || artifact.modules.length === 0) {
    fail('MAINNET_V8_PACKAGE_ARTIFACT_INVALID', 'Package artifact has no modules.');
  }
  const modules = new Set();
  artifact.modules.forEach((module, index) => {
    exactFields(module, PACKAGE_MODULE_FIELDS, `Package artifact modules[${index}]`);
    if (!MODULE_NAME.test(module.name) || modules.has(module.name)) {
      fail('MAINNET_V8_PACKAGE_ARTIFACT_INVALID', 'Package artifact module names are invalid or duplicated.');
    }
    modules.add(module.name);
    if (index > 0 && compareMainnetV8Text(artifact.modules[index - 1].name, module.name) >= 0) {
      fail('MAINNET_V8_PACKAGE_ARTIFACT_INVALID', 'Package artifact modules are not strictly protocol-sorted.');
    }
    const bytes = decodeCanonicalBase64(module.bytesBase64, `Package artifact modules[${index}].bytesBase64`);
    assertMainnetV8Decimal(module.byteLength, `Package artifact modules[${index}].byteLength`, { positive: true });
    assertHash(module.sha256, `Package artifact modules[${index}].sha256`);
    if (module.byteLength !== String(bytes.length) || module.sha256 !== sha256MainnetV8Bytes(bytes)) {
      fail('MAINNET_V8_PACKAGE_ARTIFACT_INVALID', 'Package module content address does not match its bytes.', { name: module.name });
    }
  });
  if (!Array.isArray(artifact.dependencies)) fail('MAINNET_V8_PACKAGE_ARTIFACT_INVALID', 'Package dependencies must be an array.');
  artifact.dependencies.forEach((dependency, index) => {
    assertFullId(dependency, `Package dependency ${index}`);
    if (index > 0 && compareMainnetV8Text(artifact.dependencies[index - 1], dependency) >= 0) {
      fail('MAINNET_V8_PACKAGE_ARTIFACT_INVALID', 'Package dependencies are not strictly sorted and unique.');
    }
  });
  assertHash(artifact.buildDigest, 'Package buildDigest');
  return artifact;
}

export function buildMainnetV8PackageArtifact(input) {
  const role = assertRole(input?.role);
  const modules = input.modules.map((module) => {
    if (module instanceof Uint8Array) fail('MAINNET_V8_PACKAGE_ARTIFACT_INVALID', 'Module records require an explicit name.');
    if (Object.hasOwn(module, 'bytes')) return mainnetV8PackageModuleRecord(module.name, module.bytes);
    if (Object.hasOwn(module, 'bytesBase64') && !Object.hasOwn(module, 'sha256')) {
      return mainnetV8PackageModuleRecord(module.name, module.bytesBase64);
    }
    return cloneJson(module);
  }).sort((left, right) => compareMainnetV8Text(left.name, right.name));
  const dependencies = input.dependencies
    .map((value, index) => normalizeMainnetV8ObjectId(value, `Dependency ${index}`))
    .sort(compareMainnetV8Text);
  const artifact = {
    domain: MAINNET_V8_PACKAGE_ARTIFACT_DOMAIN,
    role,
    modules,
    dependencies,
    buildDigest: normalizeBuildDigest(input.buildDigest),
  };
  assertMainnetV8PackageArtifact(artifact);
  return deepFreeze(artifact);
}

export function mainnetV8PackageCommitment(artifact) {
  assertMainnetV8PackageArtifact(artifact);
  return sha256MainnetV8Json(artifact);
}

function strippedAbiKey(key) {
  return ABI_STRIPPED_KEYS.has(key.replaceAll(/[-_]/g, '').toLowerCase());
}

function normalizeAbiValue(value, path = '$', depth = 0) {
  if (depth > MAX_JSON_DEPTH) fail('MAINNET_V8_ABI_INVALID', 'ABI descriptor is too deep.', { path });
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      fail('MAINNET_V8_ABI_INVALID', 'ABI descriptor contains a non-canonical number.', { path });
    }
    return String(value);
  }
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  if (Array.isArray(value)) return value.map((entry, index) => normalizeAbiValue(entry, `${path}[${index}]`, depth + 1));
  if (!isPlain(value)) fail('MAINNET_V8_ABI_INVALID', 'ABI descriptor contains a non-plain value.', { path });
  const result = {};
  for (const key of Object.keys(value).sort(compareMainnetV8Text)) {
    if (strippedAbiKey(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      fail('MAINNET_V8_ABI_INVALID', 'ABI descriptor contains an accessor.', { path: `${path}.${key}` });
    }
    result[key] = normalizeAbiValue(descriptor.value, `${path}.${key}`, depth + 1);
  }
  return result;
}

function namedAbiEntries(value, label) {
  let entries;
  if (Array.isArray(value)) entries = value.map((entry) => normalizeAbiValue(entry));
  else if (isPlain(value)) {
    entries = Object.entries(value).map(([name, entry]) => {
      const normalized = normalizeAbiValue(entry);
      if (!isPlain(normalized)) fail('MAINNET_V8_ABI_INVALID', `${label}.${name} must be a record.`);
      if (Object.hasOwn(normalized, 'name') && normalized.name !== name) {
        fail('MAINNET_V8_ABI_INVALID', `${label}.${name} has a conflicting name.`);
      }
      return { name, ...normalized };
    });
  } else fail('MAINNET_V8_ABI_INVALID', `${label} must be an array or name map.`);
  const names = new Set();
  for (const entry of entries) {
    if (!isPlain(entry) || !MODULE_NAME.test(entry.name) || names.has(entry.name)) {
      fail('MAINNET_V8_ABI_INVALID', `${label} contains an invalid or duplicate name.`);
    }
    names.add(entry.name);
  }
  return entries.sort((left, right) => compareMainnetV8Text(left.name, right.name)
    || compareMainnetV8Text(canonicalMainnetV8Json(left), canonicalMainnetV8Json(right)));
}

function descriptorModules(descriptor) {
  const modules = descriptor?.modules;
  if (Array.isArray(modules)) return modules.map((entry) => normalizeAbiValue(entry));
  if (isPlain(modules)) {
    return Object.entries(modules).map(([name, entry]) => {
      const normalized = normalizeAbiValue(entry);
      if (!isPlain(normalized)) fail('MAINNET_V8_ABI_INVALID', `ABI module ${name} must be a record.`);
      if (Object.hasOwn(normalized, 'name') && normalized.name !== name) {
        fail('MAINNET_V8_ABI_INVALID', `ABI module ${name} has a conflicting name.`);
      }
      return { name, ...normalized };
    });
  }
  fail('MAINNET_V8_ABI_INVALID', 'ABI descriptor modules must be an array or name map.');
}

function assertNoStrippedAbiKeys(value, path = '$') {
  if (Array.isArray(value)) return value.forEach((entry, index) => assertNoStrippedAbiKeys(entry, `${path}[${index}]`));
  if (typeof value === 'number' || typeof value === 'bigint') {
    fail('MAINNET_V8_ABI_INVALID', 'ABI artifact integers must be canonical decimal strings.', { path });
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (strippedAbiKey(key)) fail('MAINNET_V8_ABI_INVALID', 'ABI artifact retains documentation or source locations.', { path: `${path}.${key}` });
    assertNoStrippedAbiKeys(entry, `${path}.${key}`);
  }
}

export function assertMainnetV8AbiArtifact(artifact) {
  assertMainnetV8DeterministicJson(artifact, 'ABI artifact');
  exactFields(artifact, ABI_FIELDS, 'ABI artifact');
  if (artifact.domain !== MAINNET_V8_ABI_ARTIFACT_DOMAIN) fail('MAINNET_V8_ABI_INVALID', 'ABI artifact domain is invalid.');
  assertRole(artifact.role, 'ABI artifact role');
  if (!Array.isArray(artifact.modules) || artifact.modules.length === 0) fail('MAINNET_V8_ABI_INVALID', 'ABI artifact has no modules.');
  const modules = new Set();
  artifact.modules.forEach((module, index) => {
    exactFields(module, ABI_MODULE_FIELDS, `ABI artifact modules[${index}]`);
    if (!MODULE_NAME.test(module.name) || modules.has(module.name)) fail('MAINNET_V8_ABI_INVALID', 'ABI module name is invalid or duplicated.');
    modules.add(module.name);
    if (index > 0 && compareMainnetV8Text(artifact.modules[index - 1].name, module.name) >= 0) {
      fail('MAINNET_V8_ABI_INVALID', 'ABI modules are not strictly sorted.');
    }
    for (const field of ['datatypes', 'functions']) {
      if (!Array.isArray(module[field])) fail('MAINNET_V8_ABI_INVALID', `ABI ${field} must be an array.`);
      let prior = null;
      const names = new Set();
      module[field].forEach((entry) => {
        if (!isPlain(entry) || !MODULE_NAME.test(entry.name) || names.has(entry.name)) {
          fail('MAINNET_V8_ABI_INVALID', `ABI ${field} name is invalid or duplicated.`);
        }
        names.add(entry.name);
        if (prior !== null && compareMainnetV8Text(prior, entry.name) >= 0) fail('MAINNET_V8_ABI_INVALID', `ABI ${field} are not sorted.`);
        prior = entry.name;
      });
    }
  });
  assertNoStrippedAbiKeys(artifact);
  return artifact;
}

export function buildMainnetV8AbiArtifact(input) {
  const role = assertRole(input?.role);
  const modules = descriptorModules(input.descriptor).map((module) => {
    if (!MODULE_NAME.test(module.name)) fail('MAINNET_V8_ABI_INVALID', 'ABI module name is invalid.');
    const datatypes = module.datatypes ?? module.dataTypes ?? module.structs;
    const functions = module.functions;
    if (datatypes === undefined || functions === undefined) {
      fail('MAINNET_V8_ABI_INVALID', `ABI module ${module.name} omits datatypes or functions.`);
    }
    return {
      name: module.name,
      datatypes: namedAbiEntries(datatypes, `${module.name}.datatypes`),
      functions: namedAbiEntries(functions, `${module.name}.functions`),
    };
  }).sort((left, right) => compareMainnetV8Text(left.name, right.name));
  const artifact = { domain: MAINNET_V8_ABI_ARTIFACT_DOMAIN, role, modules };
  assertMainnetV8AbiArtifact(artifact);
  return deepFreeze(artifact);
}

export function mainnetV8AbiCommitment(artifact) {
  assertMainnetV8AbiArtifact(artifact);
  return sha256MainnetV8Json(artifact);
}

function assertKeyServerSetArtifact(artifact) {
  exactFields(artifact, KEY_SERVER_SET_FIELDS, 'Seal key-server-set artifact');
  if (artifact.domain !== MAINNET_V8_KEY_SERVER_SET_DOMAIN) fail('MAINNET_V8_SEAL_POLICY_INVALID', 'Key-server-set domain is invalid.');
  if (!Array.isArray(artifact.keyServers) || artifact.keyServers.length < 1 || artifact.keyServers.length > 64) {
    fail('MAINNET_V8_SEAL_POLICY_INVALID', 'Seal policy requires 1 to 64 key servers.');
  }
  let total = 0n;
  artifact.keyServers.forEach((server, index) => {
    exactFields(server, KEY_SERVER_FIELDS, `Seal keyServers[${index}]`);
    assertFullId(server.objectId, `Seal keyServers[${index}].objectId`);
    const weight = assertMainnetV8Decimal(server.weight, `Seal keyServers[${index}].weight`, { positive: true, maximum: 65_535n });
    total += weight;
    if (index > 0 && compareMainnetV8Text(artifact.keyServers[index - 1].objectId, server.objectId) >= 0) {
      fail('MAINNET_V8_SEAL_POLICY_INVALID', 'Seal key-server IDs must be strictly byte-sorted and unique.');
    }
  });
  const threshold = assertMainnetV8Decimal(artifact.threshold, 'Seal threshold', { positive: true, maximum: 65_535n });
  if (threshold > total) fail('MAINNET_V8_SEAL_POLICY_INVALID', 'Seal threshold exceeds total key-server weight.');
  return artifact;
}

function assertEncryptionPolicyArtifact(artifact, keyServerSetCommitment) {
  exactFields(artifact, ENCRYPTION_FIELDS, 'Seal encryption-policy artifact');
  if (artifact.domain !== MAINNET_V8_ENCRYPTION_POLICY_DOMAIN
    || artifact.network !== 'mainnet' || artifact.protocolVersion !== '8'
    || artifact.packageRole !== 'seal' || artifact.keyServerSetCommitment !== keyServerSetCommitment) {
    fail('MAINNET_V8_SEAL_POLICY_INVALID', 'Seal encryption-policy binding is invalid.');
  }
  if (canonicalMainnetV8Json(artifact.approvals) !== canonicalMainnetV8Json(MAINNET_V8_SEAL_APPROVALS)) {
    fail('MAINNET_V8_SEAL_POLICY_INVALID', 'Seal approval entry functions differ from the frozen v8 policy.');
  }
  artifact.approvals.forEach((entry, index) => exactFields(entry, APPROVAL_FIELDS, `Seal approval[${index}]`));
  return artifact;
}

export function assertMainnetV8SealPolicy(policy) {
  assertMainnetV8DeterministicJson(policy, 'Seal policy');
  exactFields(policy, SEAL_POLICY_FIELDS, 'Seal policy');
  if (policy.schemaVersion !== MAINNET_V8_SEAL_POLICY_SCHEMA) fail('MAINNET_V8_SEAL_POLICY_INVALID', 'Seal policy schema is invalid.');
  assertKeyServerSetArtifact(policy.keyServerSetArtifact);
  if (canonicalMainnetV8Json(policy.keyServers) !== canonicalMainnetV8Json(policy.keyServerSetArtifact.keyServers)
    || policy.threshold !== policy.keyServerSetArtifact.threshold) {
    fail('MAINNET_V8_SEAL_POLICY_INVALID', 'Seal policy arguments differ from their commitment artifact.');
  }
  assertHash(policy.keyServerSetCommitment, 'Seal keyServerSetCommitment');
  if (policy.keyServerSetCommitment !== sha256MainnetV8Json(policy.keyServerSetArtifact)) {
    fail('MAINNET_V8_SEAL_POLICY_INVALID', 'Seal key-server-set commitment does not match its canonical artifact.');
  }
  assertEncryptionPolicyArtifact(policy.encryptionPolicyArtifact, policy.keyServerSetCommitment);
  assertHash(policy.encryptionPolicyCommitment, 'Seal encryptionPolicyCommitment');
  if (policy.encryptionPolicyCommitment !== sha256MainnetV8Json(policy.encryptionPolicyArtifact)) {
    fail('MAINNET_V8_SEAL_POLICY_INVALID', 'Seal encryption-policy commitment does not match its canonical artifact.');
  }
  return policy;
}

export function buildMainnetV8SealPolicy(input) {
  if (!Array.isArray(input?.keyServers)) fail('MAINNET_V8_SEAL_POLICY_INVALID', 'Seal keyServers must be an array.');
  const keyServers = input.keyServers.map((server, index) => ({
    objectId: normalizeMainnetV8ObjectId(server.objectId, `Seal keyServers[${index}].objectId`),
    weight: decimalInput(server.weight, `Seal keyServers[${index}].weight`, { positive: true, maximum: 65_535n }),
  })).sort((left, right) => compareMainnetV8Text(left.objectId, right.objectId));
  const threshold = decimalInput(input.threshold, 'Seal threshold', { positive: true, maximum: 65_535n });
  const keyServerSetArtifact = {
    domain: MAINNET_V8_KEY_SERVER_SET_DOMAIN,
    keyServers,
    threshold,
  };
  assertKeyServerSetArtifact(keyServerSetArtifact);
  const keyServerSetCommitment = sha256MainnetV8Json(keyServerSetArtifact);
  const encryptionPolicyArtifact = {
    domain: MAINNET_V8_ENCRYPTION_POLICY_DOMAIN,
    network: 'mainnet',
    protocolVersion: '8',
    packageRole: 'seal',
    approvals: MAINNET_V8_SEAL_APPROVALS.map((entry) => ({ ...entry })),
    keyServerSetCommitment,
  };
  const policy = {
    schemaVersion: MAINNET_V8_SEAL_POLICY_SCHEMA,
    keyServers: keyServers.map((entry) => ({ ...entry })),
    threshold,
    keyServerSetArtifact,
    keyServerSetCommitment,
    encryptionPolicyArtifact,
    encryptionPolicyCommitment: sha256MainnetV8Json(encryptionPolicyArtifact),
  };
  assertMainnetV8SealPolicy(policy);
  return deepFreeze(policy);
}

function assertProtocolProfile(profile) {
  exactFields(profile, Object.keys(MAINNET_V8_PROTOCOL_PROFILE), 'Protocol profile');
  if (canonicalMainnetV8Json(profile) !== canonicalMainnetV8Json(MAINNET_V8_PROTOCOL_PROFILE)) {
    fail('MAINNET_V8_PLAN_INVALID', 'Release plan protocol profile is not the measured protocol 133 profile.');
  }
}

function artifactPackage(role, entry, index) {
  exactFields(entry, PLAN_PACKAGE_FIELDS, `Release package[${index}]`);
  if (entry.role !== role) fail('MAINNET_V8_PLAN_INVALID', 'Release packages are outside exact role order.');
  assertPackageName(role, entry.packageName, `Release package[${index}].packageName`);
  assertMainnetV8SourceArtifact(entry.sourceArtifact);
  assertMainnetV8PackageArtifact(entry.packageArtifact);
  if (entry.sourceArtifact.role !== role || entry.packageArtifact.role !== role
    || entry.sourceArtifact.packageName !== entry.packageName) {
    fail('MAINNET_V8_PLAN_INVALID', `Release package ${role} artifact roles disagree.`);
  }
  assertHash(entry.sourceCommitment, `Release package ${role} sourceCommitment`);
  assertHash(entry.packageCommitment, `Release package ${role} packageCommitment`);
  if (entry.sourceCommitment !== mainnetV8SourceCommitment(entry.sourceArtifact)
    || entry.packageCommitment !== mainnetV8PackageCommitment(entry.packageArtifact)) {
    fail('MAINNET_V8_PLAN_INVALID', `Release package ${role} commitment does not match its artifact.`);
  }
}

function releaseIdPayload(plan) {
  const payload = { ...plan };
  delete payload.releaseId;
  return payload;
}

export function assertMainnetV8ReleasePlan(plan) {
  assertMainnetV8DeterministicJson(plan, 'Release plan');
  exactFields(plan, PLAN_FIELDS, 'Release plan');
  if (plan.schemaVersion !== MAINNET_V8_RELEASE_PLAN_SCHEMA) fail('MAINNET_V8_PLAN_INVALID', 'Release plan schema is invalid.');
  exactFields(plan.chain, CHAIN_FIELDS, 'Release chain');
  if (plan.chain.network !== 'mainnet' || plan.chain.chainIdentifier !== MAINNET_V8_CHAIN_IDENTIFIER
    || plan.chain.legacyChainIdentifier !== MAINNET_V8_LEGACY_CHAIN_IDENTIFIER) {
    fail('MAINNET_V8_PLAN_INVALID', 'Release plan is not bound to exact Sui Mainnet.');
  }
  assertFullId(plan.sender, 'Release sender');
  exactFields(plan.sourceRevision, SOURCE_REVISION_FIELDS, 'Release sourceRevision');
  assertGitId(plan.sourceRevision.gitCommit, 'Release sourceRevision.gitCommit');
  assertGitId(plan.sourceRevision.gitTree, 'Release sourceRevision.gitTree');
  if (plan.sourceRevision.clean !== true) fail('MAINNET_V8_PLAN_INVALID', 'Release source must be a clean Git tree.');
  assertToolchain(plan.toolchain, 'Release toolchain');
  assertProtocolProfile(plan.protocolProfile);
  if (plan.paymentCoinType !== MAINNET_V8_PAYMENT_COIN_TYPE) fail('MAINNET_V8_PLAN_INVALID', 'Release payment coin is not Mainnet native USDC.');
  assertMainnetV8SealPolicy(plan.sealPolicy);
  if (!Array.isArray(plan.packages) || plan.packages.length !== MAINNET_V8_ROLE_ORDER.length) {
    fail('MAINNET_V8_PLAN_INVALID', 'Release plan must bind exactly seven package artifacts.');
  }
  plan.packages.forEach((entry, index) => {
    const role = MAINNET_V8_ROLE_ORDER[index];
    artifactPackage(role, entry, index);
    if (entry.sourceArtifact.release.gitCommit !== plan.sourceRevision.gitCommit
      || entry.sourceArtifact.release.gitTree !== plan.sourceRevision.gitTree
      || canonicalMainnetV8Json(entry.sourceArtifact.toolchain) !== canonicalMainnetV8Json(plan.toolchain)) {
      fail('MAINNET_V8_PLAN_INVALID', `Release package ${role} is bound to a different source or toolchain.`);
    }
  });
  if (!Array.isArray(plan.steps) || plan.steps.length !== MAINNET_V8_RELEASE_STEPS.length) {
    fail('MAINNET_V8_PLAN_INVALID', 'Release plan steps are incomplete.');
  }
  plan.steps.forEach((step, index) => exactFields(step, STEP_FIELDS, `Release step[${index}]`));
  if (canonicalMainnetV8Json(plan.steps) !== canonicalMainnetV8Json(MAINNET_V8_RELEASE_STEPS)) {
    fail('MAINNET_V8_PLAN_INVALID', 'Release plan steps differ from the frozen ten-step release.');
  }
  assertHash(plan.releaseId, 'Release releaseId');
  const expected = sha256MainnetV8Json(releaseIdPayload(plan));
  if (plan.releaseId !== expected) fail('MAINNET_V8_PLAN_INVALID', 'releaseId does not match the immutable canonical plan.', { expected });
  return plan;
}

export function buildMainnetV8ReleasePlan(input) {
  const packages = input.packages.map((entry) => ({
    role: entry.role,
    packageName: entry.packageName ?? MAINNET_V8_PACKAGE_NAMES[entry.role],
    sourceArtifact: cloneJson(entry.sourceArtifact),
    sourceCommitment: entry.sourceCommitment ?? mainnetV8SourceCommitment(entry.sourceArtifact),
    packageArtifact: cloneJson(entry.packageArtifact),
    packageCommitment: entry.packageCommitment ?? mainnetV8PackageCommitment(entry.packageArtifact),
  }));
  const plan = {
    schemaVersion: MAINNET_V8_RELEASE_PLAN_SCHEMA,
    chain: {
      network: 'mainnet',
      chainIdentifier: MAINNET_V8_CHAIN_IDENTIFIER,
      legacyChainIdentifier: MAINNET_V8_LEGACY_CHAIN_IDENTIFIER,
    },
    sender: normalizeMainnetV8ObjectId(input.sender, 'Release sender'),
    sourceRevision: cloneJson(input.sourceRevision),
    toolchain: cloneJson(input.toolchain),
    protocolProfile: { ...MAINNET_V8_PROTOCOL_PROFILE },
    paymentCoinType: MAINNET_V8_PAYMENT_COIN_TYPE,
    sealPolicy: cloneJson(input.sealPolicy),
    packages,
    steps: MAINNET_V8_RELEASE_STEPS.map((step) => ({ ...step })),
  };
  plan.releaseId = sha256MainnetV8Json(plan);
  assertMainnetV8ReleasePlan(plan);
  return deepFreeze(plan);
}

function tomlString(value, label) {
  boundedText(value, label, 16 * 1024);
  return JSON.stringify(value);
}

function parseTomlString(value, label) {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== 'string' || JSON.stringify(parsed) !== value) throw new Error('noncanonical');
    return boundedText(parsed, label, 16 * 1024);
  } catch {
    fail('MAINNET_V8_PUBLISHED_TOML_INVALID', `${label} is not one canonical TOML basic string.`);
  }
}

function assertPublishedEntry(entry, index) {
  exactFields(entry, [
    'packageName', 'source', 'publishedAt', 'originalId', 'version',
    'toolchainVersion', 'buildConfig', 'upgradeCapability',
  ], `Published entry[${index}]`);
  const role = MAINNET_V8_ROLE_ORDER[index];
  assertPackageName(role, entry.packageName, `Published entry[${index}].packageName`);
  boundedText(entry.source, `Published entry[${index}].source`, 16 * 1024);
  if (resolve(entry.source) !== entry.source || basename(entry.source) !== entry.packageName) {
    fail('MAINNET_V8_PUBLISHED_TOML_INVALID', `Published entry ${index} source is not its absolute package directory.`);
  }
  assertFullId(entry.publishedAt, `Published entry[${index}].publishedAt`);
  assertFullId(entry.originalId, `Published entry[${index}].originalId`);
  assertMainnetV8Decimal(entry.version, `Published entry[${index}].version`, { positive: true });
  boundedText(entry.toolchainVersion, `Published entry[${index}].toolchainVersion`, 256);
  exactFields(entry.buildConfig, ['flavor', 'edition'], `Published entry[${index}].buildConfig`);
  if (entry.buildConfig.flavor !== 'sui' || entry.buildConfig.edition !== '2024') {
    fail('MAINNET_V8_PUBLISHED_TOML_INVALID', 'Published build config is not exact Sui 2024.');
  }
  assertFullId(entry.upgradeCapability, `Published entry[${index}].upgradeCapability`);
}

function assertPublishedFile(value) {
  exactFields(value, ['buildEnv', 'chainId', 'entries'], 'Published.toml value');
  if (value.buildEnv !== 'mainnet' || value.chainId !== MAINNET_V8_LEGACY_CHAIN_IDENTIFIER
    || !Array.isArray(value.entries) || value.entries.length > MAINNET_V8_ROLE_ORDER.length) {
    fail('MAINNET_V8_PUBLISHED_TOML_INVALID', 'Published.toml is not an exact Mainnet v8 prefix.');
  }
  value.entries.forEach(assertPublishedEntry);
  return value;
}

export function renderMainnetV8PublishedToml(value) {
  assertMainnetV8DeterministicJson(value, 'Published.toml value');
  assertPublishedFile(value);
  const lines = [
    '# generated by Move',
    '# this file contains metadata from ephemeral publications',
    '# this file should not be committed to source control',
    '',
    `build-env = ${tomlString(value.buildEnv, 'build-env')}`,
    `chain-id = ${tomlString(value.chainId, 'chain-id')}`,
    '',
  ];
  value.entries.forEach((entry, index) => {
    if (index > 0) lines.push('');
    lines.push(
      '[[published]]',
      `source = { local = ${tomlString(entry.source, 'published source')} }`,
      `published-at = ${tomlString(entry.publishedAt, 'published-at')}`,
      `original-id = ${tomlString(entry.originalId, 'original-id')}`,
      `version = ${entry.version}`,
      `toolchain-version = ${tomlString(entry.toolchainVersion, 'toolchain-version')}`,
      `build-config = { flavor = ${tomlString(entry.buildConfig.flavor, 'flavor')}, edition = ${tomlString(entry.buildConfig.edition, 'edition')} }`,
      `upgrade-capability = ${tomlString(entry.upgradeCapability, 'upgrade-capability')}`,
    );
  });
  return `${lines.join('\n')}\n`;
}

export function parseMainnetV8PublishedToml(text) {
  boundedText(text, 'Published.toml', 1024 * 1024);
  if (text.includes('\r')) fail('MAINNET_V8_PUBLISHED_TOML_INVALID', 'Published.toml must use canonical LF lines.');
  const lines = text.split('\n');
  if (lines.at(-1) !== '') fail('MAINNET_V8_PUBLISHED_TOML_INVALID', 'Published.toml must end with LF.');
  lines.pop();
  const expectedHeader = [
    '# generated by Move',
    '# this file contains metadata from ephemeral publications',
    '# this file should not be committed to source control',
    '',
  ];
  if (lines.slice(0, 4).some((line, index) => line !== expectedHeader[index])) {
    fail('MAINNET_V8_PUBLISHED_TOML_INVALID', 'Published.toml generated header is invalid.');
  }
  const buildMatch = /^build-env = (".*")$/.exec(lines[4] ?? '');
  const chainMatch = /^chain-id = (".*")$/.exec(lines[5] ?? '');
  if (!buildMatch || !chainMatch || lines[6] !== '') fail('MAINNET_V8_PUBLISHED_TOML_INVALID', 'Published.toml root fields are invalid.');
  const result = {
    buildEnv: parseTomlString(buildMatch[1], 'build-env'),
    chainId: parseTomlString(chainMatch[1], 'chain-id'),
    entries: [],
  };
  let index = 7;
  while (index < lines.length) {
    if (result.entries.length > 0) {
      if (lines[index] !== '') fail('MAINNET_V8_PUBLISHED_TOML_INVALID', 'Published.toml entries need one blank separator.');
      index += 1;
    }
    if (lines[index] !== '[[published]]') fail('MAINNET_V8_PUBLISHED_TOML_INVALID', 'Published.toml entry header is invalid.');
    const source = /^source = \{ local = (".*") \}$/.exec(lines[index + 1] ?? '');
    const publishedAt = /^published-at = (".*")$/.exec(lines[index + 2] ?? '');
    const originalId = /^original-id = (".*")$/.exec(lines[index + 3] ?? '');
    const version = /^version = ([0-9]+)$/.exec(lines[index + 4] ?? '');
    const toolchainVersion = /^toolchain-version = (".*")$/.exec(lines[index + 5] ?? '');
    const build = /^build-config = \{ flavor = (".*"), edition = (".*") \}$/.exec(lines[index + 6] ?? '');
    const cap = /^upgrade-capability = (".*")$/.exec(lines[index + 7] ?? '');
    if (!source || !publishedAt || !originalId || !version || !toolchainVersion || !build || !cap) {
      fail('MAINNET_V8_PUBLISHED_TOML_INVALID', `Published.toml entry ${result.entries.length} is malformed.`);
    }
    const sourcePath = parseTomlString(source[1], 'published source');
    result.entries.push({
      packageName: basename(sourcePath),
      source: sourcePath,
      publishedAt: parseTomlString(publishedAt[1], 'published-at'),
      originalId: parseTomlString(originalId[1], 'original-id'),
      version: version[1],
      toolchainVersion: parseTomlString(toolchainVersion[1], 'toolchain-version'),
      buildConfig: {
        flavor: parseTomlString(build[1], 'build flavor'),
        edition: parseTomlString(build[2], 'build edition'),
      },
      upgradeCapability: parseTomlString(cap[1], 'upgrade-capability'),
    });
    index += 8;
  }
  assertPublishedFile(result);
  if (renderMainnetV8PublishedToml(result) !== text) {
    fail('MAINNET_V8_PUBLISHED_TOML_INVALID', 'Published.toml is not in deterministic canonical form.');
  }
  return deepFreeze(result);
}

function eventHash(event) {
  const payload = { ...event };
  delete payload.eventSha256;
  return sha256MainnetV8Json(payload);
}

function walHash(wal) {
  const payload = { ...wal };
  delete payload.walSha256;
  return sha256MainnetV8Json(payload);
}

function assertRecordedAt(value) {
  boundedText(value, 'WAL recordedAt', 64);
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.valueOf()) || timestamp.toISOString() !== value) {
    fail('MAINNET_V8_WAL_INVALID', 'WAL recordedAt must be one canonical ISO-8601 instant.');
  }
}

function assertWalTransition(previous, current) {
  if (!previous) {
    if (current.revision !== '1' || current.ordinal !== '0' || current.status !== 'READY'
      || current.previousEventSha256 !== ZERO_HASH) {
      fail('MAINNET_V8_WAL_TRANSITION_INVALID', 'The first WAL event must be revision 1, ordinal 0 READY.');
    }
    return;
  }
  if (BigInt(current.revision) !== BigInt(previous.revision) + 1n
    || current.previousEventSha256 !== previous.eventSha256) {
    fail('MAINNET_V8_WAL_TRANSITION_INVALID', 'WAL revision or hash link is discontinuous.');
  }
  const sameOrdinal = current.ordinal === previous.ordinal;
  const nextOrdinal = BigInt(current.ordinal) === BigInt(previous.ordinal) + 1n;
  const valid = previous.status === 'READY' && current.status === 'SIGNED' && sameOrdinal
    || previous.status === 'SIGNED' && current.status === 'OUTCOME_PENDING' && sameOrdinal
    || previous.status === 'OUTCOME_PENDING'
      && ['OUTCOME_PENDING', 'FINALIZED'].includes(current.status) && sameOrdinal
    || previous.status === 'FINALIZED' && current.status === 'READY' && nextOrdinal
      && BigInt(current.ordinal) < BigInt(MAINNET_V8_RELEASE_STEPS.length);
  if (!valid) fail('MAINNET_V8_WAL_TRANSITION_INVALID', `Invalid WAL transition ${previous.status} -> ${current.status}.`);
}

function assertWalEvent(event, index, previous) {
  exactFields(event, WAL_EVENT_FIELDS, `WAL event[${index}]`);
  assertMainnetV8Decimal(event.revision, `WAL event[${index}].revision`, { positive: true });
  assertMainnetV8Decimal(event.ordinal, `WAL event[${index}].ordinal`);
  if (BigInt(event.ordinal) >= BigInt(MAINNET_V8_RELEASE_STEPS.length)
    || !MAINNET_V8_WAL_STATUSES.includes(event.status)) {
    fail('MAINNET_V8_WAL_INVALID', `WAL event ${index} status or ordinal is invalid.`);
  }
  if (!isPlain(event.evidence)) fail('MAINNET_V8_WAL_INVALID', `WAL event ${index} evidence must be a record.`);
  assertMainnetV8DeterministicJson(event.evidence, `WAL event[${index}].evidence`);
  assertRecordedAt(event.recordedAt);
  assertHash(event.previousEventSha256, `WAL event[${index}].previousEventSha256`);
  assertHash(event.eventSha256, `WAL event[${index}].eventSha256`);
  if (event.eventSha256 !== eventHash(event)) fail('MAINNET_V8_WAL_INVALID', `WAL event ${index} hash is invalid.`);
  assertWalTransition(previous, event);
}

export function assertMainnetV8ReleaseWal(wal) {
  assertMainnetV8DeterministicJson(wal, 'Release WAL');
  exactFields(wal, WAL_FIELDS, 'Release WAL');
  if (wal.schemaVersion !== MAINNET_V8_RELEASE_WAL_SCHEMA) fail('MAINNET_V8_WAL_INVALID', 'Release WAL schema is invalid.');
  assertMainnetV8ReleasePlan(wal.plan);
  if (wal.releaseId !== wal.plan.releaseId) fail('MAINNET_V8_WAL_INVALID', 'Release WAL is bound to another plan.');
  assertMainnetV8Decimal(wal.revision, 'WAL revision', { positive: true });
  if (!Array.isArray(wal.events) || wal.events.length === 0 || wal.revision !== String(wal.events.length)) {
    fail('MAINNET_V8_WAL_INVALID', 'WAL revision must equal its append-only event count.');
  }
  let previous = null;
  wal.events.forEach((event, index) => {
    assertWalEvent(event, index, previous);
    previous = event;
  });
  if (wal.headEventSha256 !== previous.eventSha256) fail('MAINNET_V8_WAL_INVALID', 'WAL head hash is stale.');
  assertHash(wal.walSha256, 'WAL walSha256');
  if (wal.walSha256 !== walHash(wal)) fail('MAINNET_V8_WAL_INVALID', 'WAL envelope hash is invalid.');
  return wal;
}

function makeWalEvent({ revision, ordinal, status, evidence, recordedAt, previousEventSha256 }) {
  const event = {
    revision,
    ordinal,
    status,
    evidence: cloneJson(evidence),
    recordedAt: recordedAt ?? new Date().toISOString(),
    previousEventSha256,
  };
  event.eventSha256 = eventHash(event);
  return event;
}

async function syncDirectory(path) {
  let handle;
  try {
    handle = await open(path, 'r');
    await handle.sync();
  } finally {
    await handle?.close();
  }
}

async function atomicWrite(path, text) {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.${basename(path)}.${process.pid}.${randomBytes(12).toString('hex')}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, path);
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function withWalLock(path, action) {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = `${path}.lock`;
  let lock;
  try {
    lock = await open(lockPath, 'wx', 0o600);
    await lock.writeFile(`${process.pid}\n`, 'utf8');
    await lock.sync();
    await syncDirectory(directory);
  } catch (error) {
    if (lock) {
      await lock.close().catch(() => {});
      await unlink(lockPath).catch(() => {});
      await syncDirectory(directory).catch(() => {});
    }
    if (error?.code === 'EEXIST') fail('MAINNET_V8_WAL_LOCKED', 'Release WAL is locked by another process.', { lockPath });
    throw error;
  }
  try {
    return await action();
  } finally {
    await lock.close().catch(() => {});
    await unlink(lockPath).catch(() => {});
    await syncDirectory(directory).catch(() => {});
  }
}

async function readWalFile(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') fail('MAINNET_V8_WAL_NOT_FOUND', 'Release WAL does not exist.', { path });
    throw error;
  }
  let wal;
  try { wal = JSON.parse(text); } catch { fail('MAINNET_V8_WAL_INVALID', 'Release WAL is not JSON.'); }
  assertMainnetV8ReleaseWal(wal);
  if (`${canonicalMainnetV8Json(wal)}\n` !== text) fail('MAINNET_V8_WAL_INVALID', 'Release WAL bytes are not canonical.');
  return wal;
}

export async function readMainnetV8ReleaseWal(path) {
  return deepFreeze(await readWalFile(resolve(path)));
}

export async function createMainnetV8ReleaseWal(path, plan, options = {}) {
  assertMainnetV8ReleasePlan(plan);
  const target = resolve(path);
  return withWalLock(target, async () => {
    try {
      await readFile(target, 'utf8');
      fail('MAINNET_V8_WAL_EXISTS', 'Release WAL already exists.', { path: target });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const event = makeWalEvent({
      revision: '1',
      ordinal: '0',
      status: 'READY',
      evidence: options.evidence ?? {},
      recordedAt: options.recordedAt,
      previousEventSha256: ZERO_HASH,
    });
    const wal = {
      schemaVersion: MAINNET_V8_RELEASE_WAL_SCHEMA,
      releaseId: plan.releaseId,
      plan: cloneJson(plan),
      revision: '1',
      headEventSha256: event.eventSha256,
      events: [event],
    };
    wal.walSha256 = walHash(wal);
    assertMainnetV8ReleaseWal(wal);
    await atomicWrite(target, `${canonicalMainnetV8Json(wal)}\n`);
    return deepFreeze(wal);
  });
}

export async function appendMainnetV8ReleaseWal(path, input) {
  const target = resolve(path);
  return withWalLock(target, async () => {
    const current = await readWalFile(target);
    if (input.expectedRevision !== current.revision
      || input.expectedHeadEventSha256 !== current.headEventSha256) {
      fail('MAINNET_V8_WAL_CAS_MISMATCH', 'Release WAL CAS revision or head hash is stale.', {
        expectedRevision: input.expectedRevision,
        actualRevision: current.revision,
        expectedHeadEventSha256: input.expectedHeadEventSha256,
        actualHeadEventSha256: current.headEventSha256,
      });
    }
    const event = makeWalEvent({
      revision: (BigInt(current.revision) + 1n).toString(),
      ordinal: decimalInput(input.ordinal, 'WAL ordinal'),
      status: input.status,
      evidence: input.evidence ?? {},
      recordedAt: input.recordedAt,
      previousEventSha256: current.headEventSha256,
    });
    const wal = {
      ...cloneJson(current),
      revision: event.revision,
      headEventSha256: event.eventSha256,
      events: [...current.events.map(cloneJson), event],
    };
    delete wal.walSha256;
    wal.walSha256 = walHash(wal);
    assertMainnetV8ReleaseWal(wal);
    await atomicWrite(target, `${canonicalMainnetV8Json(wal)}\n`);
    return deepFreeze(wal);
  });
}

// Runner-facing stable aliases. The longer names above remain useful in tests
// because they make the Mainnet-only scope explicit, while these names keep the
// release runner compact and form the public integration contract.
export const ROLE_ORDER = MAINNET_V8_ROLE_ORDER;
export const ROLE_DEPENDENCIES = MAINNET_V8_ROLE_DEPENDENCIES;
export const ROLE_PACKAGE_NAMES = MAINNET_V8_PACKAGE_NAMES;
export const canonicalJson = canonicalMainnetV8Json;

export function sha256Bytes(value) {
  return new Uint8Array(createHash('sha256').update(asBytes(value)).digest());
}

export function sha256Hex(value) {
  return Buffer.from(sha256Bytes(value)).toString('hex');
}

export const buildSourceArtifact = buildMainnetV8SourceArtifact;
export const assertSourceArtifact = assertMainnetV8SourceArtifact;
export const computeSourceCommitment = mainnetV8SourceCommitment;
export const buildPackageArtifact = buildMainnetV8PackageArtifact;
export const assertPackageArtifact = assertMainnetV8PackageArtifact;
export const computePackageCommitment = mainnetV8PackageCommitment;
export const buildAbiArtifact = buildMainnetV8AbiArtifact;
export const assertAbiArtifact = assertMainnetV8AbiArtifact;
export const computeAbiCommitment = mainnetV8AbiCommitment;
export const buildSealPolicy = buildMainnetV8SealPolicy;
export const assertSealPolicy = assertMainnetV8SealPolicy;
export const createReleasePlan = buildMainnetV8ReleasePlan;
export const assertReleasePlan = assertMainnetV8ReleasePlan;
export const renderPublishedToml = renderMainnetV8PublishedToml;
export const parsePublishedToml = parseMainnetV8PublishedToml;

export function computeReleaseId(planOrPayload) {
  assertMainnetV8DeterministicJson(planOrPayload, 'Release ID payload');
  const payload = cloneJson(planOrPayload);
  delete payload.releaseId;
  return sha256MainnetV8Json(payload);
}

export async function createReleaseWal(pathOrOptions, plan, options = {}) {
  if (typeof pathOrOptions === 'string') {
    return createMainnetV8ReleaseWal(pathOrOptions, plan, options);
  }
  const input = pathOrOptions ?? {};
  const event = input.event ?? {};
  if (event.status !== undefined && event.status !== 'READY') {
    fail('MAINNET_V8_WAL_TRANSITION_INVALID', 'createReleaseWal initial event must be READY.');
  }
  return createMainnetV8ReleaseWal(input.path, input.plan, {
    recordedAt: event.recordedAt ?? input.recordedAt,
    evidence: event.evidence ?? input.evidence ?? {},
  });
}

export async function readReleaseWal(pathOrOptions) {
  const path = typeof pathOrOptions === 'string' ? pathOrOptions : pathOrOptions?.path;
  return readMainnetV8ReleaseWal(path);
}

export async function appendReleaseWal(options) {
  const event = options?.event ?? {};
  const expectedHeadEventSha256 = options.expectedHeadEventSha256 ?? options.expectedHeadHash;
  let evidence = event.evidence ?? {};
  if (options.blobs !== undefined) {
    if (!isPlain(evidence) || Object.hasOwn(evidence, 'blobs')) {
      fail('MAINNET_V8_WAL_INVALID', 'appendReleaseWal blobs conflict with event evidence.');
    }
    evidence = { ...cloneJson(evidence), blobs: cloneJson(options.blobs) };
  }
  return appendMainnetV8ReleaseWal(options.path, {
    expectedRevision: options.expectedRevision,
    expectedHeadEventSha256,
    ordinal: event.ordinal,
    status: event.status,
    evidence,
    recordedAt: event.recordedAt,
  });
}
