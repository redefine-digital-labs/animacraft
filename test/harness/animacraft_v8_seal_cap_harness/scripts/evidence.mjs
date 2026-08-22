import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PROFILE_SCHEMA = 'animacraft.maker-v8-sui-protocol-profile.v1';
const EVIDENCE_SCHEMA = 'animacraft-v8-seal-cap-evidence.v1';
const APPROVED_PROFILE_ARTIFACT = 'approved-protocol-profile.json';
const PROTOCOL_ARTIFACT = 'protocol-config-v130.rpc.json';
const SCENARIO_ARTIFACTS = Object.freeze({
  '333-colored': 'seal-333-colored.rpc.json',
  '334-colored': 'seal-334-colored.rpc.json',
  '500-colorless': 'seal-500-colorless.rpc.json',
  '501-colorless': 'seal-501-colorless.rpc.json',
});
export const EVIDENCE_SCENARIO_NAMES = Object.freeze(Object.keys(SCENARIO_ARTIFACTS));
export const APPROVED_PROTOCOL_PROFILE = Object.freeze({
  schemaVersion: PROFILE_SCHEMA,
  protocolVersion: '130',
  objectRuntimeMaxNumCachedObjects: '1000',
  objectRuntimeMaxNumStoreEntries: '1000',
});
export const APPROVED_PROTOCOL_PROFILE_HASH =
  '1b38afda274cb9a9ebd8307aec0af689d2a396db960fc3c1020bfd8188450ec0';

function fail(message) {
  throw new Error(`seal-cap evidence: ${message}`);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalSha256(value) {
  return sha256Bytes(canonicalJson(value));
}

function json(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`cannot parse ${path}: ${error.message}`);
  }
}

function exact(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(`${label} mismatch: expected ${canonicalJson(expected)}, got ${canonicalJson(actual)}`);
  }
}

export function protocolProfileFromRpc(envelope) {
  if (!envelope || envelope.error || !envelope.result) {
    fail(`protocol-config RPC failed: ${canonicalJson(envelope?.error ?? envelope)}`);
  }
  const attributes = envelope.result.attributes ?? {};
  const cached = attributes.object_runtime_max_num_cached_objects?.u64;
  const stored = attributes.object_runtime_max_num_store_entries?.u64;
  if (typeof cached !== 'string' || typeof stored !== 'string') {
    fail('protocol-config RPC omitted typed ObjectRuntime u64 limits');
  }
  return {
    schemaVersion: PROFILE_SCHEMA,
    protocolVersion: String(envelope.result.protocolVersion),
    objectRuntimeMaxNumCachedObjects: cached,
    objectRuntimeMaxNumStoreEntries: stored,
  };
}

export function assertApprovedProtocolProfile(envelope, approvedProfile, canonicalHash) {
  const actual = protocolProfileFromRpc(envelope);
  exact(actual, approvedProfile, 'approved protocol profile');
  const actualHash = canonicalSha256(actual);
  if (actualHash !== canonicalHash) {
    fail(`approved protocol profile hash mismatch: expected ${canonicalHash}, got ${actualHash}`);
  }
  return actual;
}

function assertRawEffects(rawEffects, expectedLength, label) {
  if (!Array.isArray(rawEffects) || rawEffects.length !== expectedLength) {
    fail(`${label} raw effects length mismatch: expected ${expectedLength}, got ${rawEffects?.length}`);
  }
  if (rawEffects.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    fail(`${label} raw effects are not a canonical byte vector`);
  }
}

function effectShape(result) {
  const effects = result.effects ?? {};
  return {
    messageVersion: effects.messageVersion,
    created: (effects.created ?? []).length,
    mutated: (effects.mutated ?? []).length,
    deleted: (effects.deleted ?? []).length,
    wrapped: (effects.wrapped ?? []).length,
    unwrapped: (effects.unwrapped ?? []).length,
    eventCount: (result.events ?? []).length,
    objectChangeTypes: (result.objectChanges ?? []).map(({ type }) => type),
  };
}

function assertSealCall(result, label) {
  const transaction = result.transaction?.data?.transaction;
  const commands = transaction?.transactions;
  const call = commands?.length === 1 ? commands[0]?.MoveCall : null;
  if (transaction?.kind !== 'ProgrammableTransaction'
      || !call
      || call.module !== 'core_v8'
      || call.function !== 'seal'
      || !Array.isArray(call.arguments)
      || call.arguments.length !== 3) {
    fail(`${label} is not an isolated core_v8::seal transaction`);
  }
}

function assertScenarioResult(result, scenario, canonicalResult, label) {
  if (!result || result.digest !== result.effects?.transactionDigest) {
    fail(`${label} digest is not bound to typed effects`);
  }
  assertSealCall(result, label);
  const status = result.effects?.status ?? {};
  if (status.status !== scenario.status) {
    fail(`${label} status mismatch: expected ${scenario.status}, got ${status.status}`);
  }
  if (scenario.status === 'failure' && status.error !== scenario.expectedError) {
    fail(`${label} failure mismatch: ${status.error}`);
  }
  if (scenario.status === 'success' && Object.hasOwn(status, 'error')) {
    fail(`${label} successful effects unexpectedly contain an error`);
  }
  exact(result.effects?.gasUsed, scenario.gasUsed, `${label} gasUsed`);
  assertRawEffects(result.rawEffects, scenario.rawEffectsLength, label);
  if ((result.events ?? []).length !== scenario.eventCount) {
    fail(`${label} event count mismatch`);
  }
  if (canonicalResult) {
    exact(effectShape(result), effectShape(canonicalResult), `${label} typed effects shape`);
  }
}

export function loadAndVerifyEvidence(harnessDirectory) {
  const evidenceDirectory = join(harnessDirectory, 'evidence');
  const manifest = json(join(evidenceDirectory, 'manifest.json'));
  if (manifest.schema !== EVIDENCE_SCHEMA) fail(`unsupported manifest schema ${manifest.schema}`);

  const approvedProfile = json(join(
    evidenceDirectory,
    manifest.approvedProtocolProfile?.file ?? '',
  ));
  if (manifest.approvedProtocolProfile?.file !== APPROVED_PROFILE_ARTIFACT) {
    fail(`approved protocol profile artifact must be ${APPROVED_PROFILE_ARTIFACT}`);
  }
  if (approvedProfile.schemaVersion !== PROFILE_SCHEMA) {
    fail(`unsupported protocol profile schema ${approvedProfile.schemaVersion}`);
  }
  exact(approvedProfile, APPROVED_PROTOCOL_PROFILE, 'approved protocol profile file');
  const profileHash = canonicalSha256(approvedProfile);
  if (manifest.approvedProtocolProfile.canonicalSha256 !== APPROVED_PROTOCOL_PROFILE_HASH
      || profileHash !== APPROVED_PROTOCOL_PROFILE_HASH) {
    fail(`approved profile hash mismatch: expected ${manifest.approvedProtocolProfile.canonicalSha256}, got ${profileHash}`);
  }

  const artifactNames = Object.keys(manifest.artifacts ?? {}).sort();
  exact(
    artifactNames,
    [PROTOCOL_ARTIFACT, ...Object.values(SCENARIO_ARTIFACTS)].sort(),
    'canonical artifact allowlist',
  );
  const scenarioNames = Object.keys(manifest.scenarios ?? {});
  exact(scenarioNames, EVIDENCE_SCENARIO_NAMES, 'canonical scenario allowlist');
  const expectedFiles = [
    manifest.approvedProtocolProfile.file,
    'manifest.json',
    ...artifactNames,
  ].sort();
  const actualFiles = readdirSync(evidenceDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map(({ name }) => name)
    .sort();
  exact(actualFiles, expectedFiles, 'evidence exact file allowlist');

  const artifacts = new Map();
  for (const name of artifactNames) {
    const path = join(evidenceDirectory, name);
    const bytes = readFileSync(path);
    const expected = manifest.artifacts[name];
    if (statSync(path).size !== expected.bytes || sha256Bytes(bytes) !== expected.sha256) {
      fail(`${name} byte length or SHA-256 drift`);
    }
    artifacts.set(name, JSON.parse(bytes.toString('utf8')));
  }

  const protocolArtifact = artifacts.get(PROTOCOL_ARTIFACT);
  assertApprovedProtocolProfile(
    protocolArtifact,
    approvedProfile,
    manifest.approvedProtocolProfile.canonicalSha256,
  );

  for (const [name, scenario] of Object.entries(manifest.scenarios ?? {})) {
    if (scenario.artifact !== SCENARIO_ARTIFACTS[name]) {
      fail(`${name} must use canonical artifact ${SCENARIO_ARTIFACTS[name]}`);
    }
    if (scenario.cacheDemand !== (2 * scenario.styles) + scenario.referencedColorPairs) {
      fail(`${name} cache-demand equation drift`);
    }
    if (scenario.colors < scenario.referencedColorPairs) {
      fail(`${name} references more color pairs than declared colors`);
    }
    const envelope = artifacts.get(scenario.artifact);
    if (!envelope || envelope.error || !envelope.result) {
      fail(`${name} canonical RPC artifact is missing a result`);
    }
    if (envelope.result.digest !== scenario.originalDigest) {
      fail(`${name} canonical digest drift`);
    }
    assertScenarioResult(envelope.result, scenario, null, `${name} canonical artifact`);
  }

  return { approvedProfile, artifacts, evidenceDirectory, manifest };
}

export function assertReplayMatchesEvidence(name, envelope, evidence) {
  const scenario = evidence.manifest.scenarios?.[name];
  if (!scenario) fail(`unknown replay scenario ${name}`);
  if (!envelope || envelope.error || !envelope.result) {
    fail(`${name} replay RPC failed: ${canonicalJson(envelope?.error ?? envelope)}`);
  }
  const canonicalResult = evidence.artifacts.get(scenario.artifact)?.result;
  assertScenarioResult(envelope.result, scenario, canonicalResult, `${name} replay`);
  return {
    name,
    digest: envelope.result.digest,
    status: envelope.result.effects.status.status,
    cacheDemand: scenario.cacheDemand,
    gasUsed: envelope.result.effects.gasUsed,
    rawEffectsLength: envelope.result.rawEffects.length,
  };
}
