import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmod, mkdtemp, readFile, readdir, stat, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  MAINNET_V8_ABI_ARTIFACT_DOMAIN,
  MAINNET_V8_CHAIN_IDENTIFIER,
  MAINNET_V8_ENCRYPTION_POLICY_DOMAIN,
  MAINNET_V8_KEY_SERVER_SET_DOMAIN,
  MAINNET_V8_LEGACY_CHAIN_IDENTIFIER,
  MAINNET_V8_PACKAGE_NAMES,
  MAINNET_V8_PAYMENT_COIN_TYPE,
  MAINNET_V8_RELEASE_STEPS,
  MAINNET_V8_ROLE_DEPENDENCIES,
  MAINNET_V8_ROLE_ORDER,
  MAINNET_V8_SOURCE_ARTIFACT_DOMAIN,
  MainnetV8ReleaseError,
  appendReleaseWal,
  appendMainnetV8ReleaseWal,
  assertMainnetV8AbiArtifact,
  assertMainnetV8DeterministicJson,
  assertMainnetV8PackageArtifact,
  assertMainnetV8ReleasePlan,
  assertMainnetV8SealPolicy,
  assertMainnetV8SourceArtifact,
  buildMainnetV8AbiArtifact,
  buildMainnetV8PackageArtifact,
  buildMainnetV8ReleasePlan,
  buildMainnetV8SealPolicy,
  buildMainnetV8SourceArtifact,
  canonicalMainnetV8Json,
  compareMainnetV8Text,
  computeReleaseId,
  createReleaseWal,
  createMainnetV8ReleaseWal,
  mainnetV8AbiCommitment,
  mainnetV8PackageCommitment,
  mainnetV8PackageModuleRecord,
  mainnetV8SourceCommitment,
  mainnetV8SourceFileRecord,
  parseMainnetV8PublishedToml,
  readMainnetV8ReleaseWal,
  readReleaseWal,
  renderMainnetV8PublishedToml,
  sha256MainnetV8Bytes,
  sha256MainnetV8Json,
  sha256Bytes,
  sha256Hex,
} from '../scripts/mainnet-v8-release-lib.mjs';

const id = (byte) => `0x${byte.toString(16).padStart(2, '0').repeat(32)}`;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const clone = (value) => structuredClone(value);
const sourceRevision = Object.freeze({ gitCommit: 'a'.repeat(40), gitTree: 'b'.repeat(40), clean: true });
const toolchain = Object.freeze({
  suiVersion: '1.77.2-51d177ad7d65',
  suiBinarySha256: 'c'.repeat(64),
  frameworkRevision: '73dd2c2ba6f9fdb21d7ffde2b50a3f2f0ac39bc1',
});

function artifacts(role, index) {
  const sourceArtifact = buildMainnetV8SourceArtifact({
    role,
    release: { gitCommit: sourceRevision.gitCommit, gitTree: sourceRevision.gitTree },
    toolchain,
    files: [
      mainnetV8SourceFileRecord('sources/zeta.move', `module ${role}::zeta {}`),
      mainnetV8SourceFileRecord('Move.lock', `[move]\nversion = ${index + 1}`),
      mainnetV8SourceFileRecord('Move.toml', `[package]\nname = "${MAINNET_V8_PACKAGE_NAMES[role]}"`),
      mainnetV8SourceFileRecord('sources/alpha.move', `module ${role}::alpha {}`),
    ],
  });
  const packageArtifact = buildMainnetV8PackageArtifact({
    role,
    modules: [
      { name: 'zeta', bytes: Uint8Array.of(index + 3, 2, 1) },
      { name: 'alpha', bytes: Uint8Array.of(index + 1, 4, 5) },
    ],
    dependencies: [id(index + 20), id(2), id(1)],
    buildDigest: Uint8Array.from({ length: 32 }, () => index + 1),
  });
  const abiArtifact = buildMainnetV8AbiArtifact({
    role,
    descriptor: {
      modules: {
        zeta: {
          documentation: 'must disappear',
          datatypes: { Zed: { abilities: ['drop'], sourceLocation: { line: 1 } } },
          functions: { zed: { visibility: 'public', parameters: [], returns: [] } },
        },
        alpha: {
          datatypes: { Alpha: { abilities: [], typeParameters: [] } },
          functions: { alpha: { visibility: 'public', parameters: [], returns: [], index: 0n } },
        },
      },
    },
  });
  return {
    role,
    packageName: MAINNET_V8_PACKAGE_NAMES[role],
    sourceArtifact,
    sourceCommitment: mainnetV8SourceCommitment(sourceArtifact),
    packageArtifact,
    packageCommitment: mainnetV8PackageCommitment(packageArtifact),
    abiArtifact,
    abiCommitment: mainnetV8AbiCommitment(abiArtifact),
  };
}

function fixturePlan() {
  return buildMainnetV8ReleasePlan({
    sender: id(173),
    sourceRevision,
    toolchain,
    sealPolicy: buildMainnetV8SealPolicy({
      keyServers: [{
        objectId: '0x686098f1439237fff9f36b99c7329683c22979d2005c2465cb891acb012a7595',
        weight: 1,
      }],
      threshold: 1,
    }),
    packages: MAINNET_V8_ROLE_ORDER.map(artifacts),
  });
}

function expectCode(code) {
  return (error) => error instanceof MainnetV8ReleaseError && error.code === code;
}

test('canonical JSON is safe, injective, and sorted by ECMAScript UTF-16 code units', () => {
  const value = { '\ue000': 2, '😀': 1, a: true };
  assert.equal(compareMainnetV8Text('😀', '\ue000'), -1);
  assert.equal(canonicalMainnetV8Json(value), '{"a":true,"😀":1,"":2}');
  assert.equal(sha256MainnetV8Json(value), hash(canonicalMainnetV8Json(value)));
  assert.equal(sha256MainnetV8Bytes(Uint8Array.of(0, 1, 2)), hash(Buffer.from([0, 1, 2])));
  assert.equal(sha256Hex('runner-api'), hash('runner-api'));
  assert.equal(Buffer.from(sha256Bytes('runner-api')).toString('hex'), hash('runner-api'));

  const cases = [];
  const cycle = {}; cycle.self = cycle; cases.push(cycle);
  const accessor = {}; Object.defineProperty(accessor, 'trap', { enumerable: true, get() { return 1; } }); cases.push(accessor);
  const sparse = new Array(1); cases.push(sparse);
  const decorated = []; decorated.extra = true; cases.push(decorated);
  const symbol = { [Symbol('hidden')]: true }; cases.push(symbol);
  cases.push({ value: 1n }, { value: Infinity }, { value: -0 }, { value: undefined });
  cases.forEach((entry) => assert.throws(
    () => assertMainnetV8DeterministicJson(entry),
    expectCode('MAINNET_V8_JSON_DOMAIN_INVALID'),
  ));
});

test('the seven roles, direct dependency DAG, package names, and ten release ordinals are frozen', () => {
  assert.deepEqual(MAINNET_V8_ROLE_ORDER, ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release']);
  assert.deepEqual(MAINNET_V8_ROLE_DEPENDENCIES, {
    core: [],
    seal: ['core'],
    runtime: ['core', 'seal'],
    output: ['core', 'seal', 'runtime'],
    physical: ['core', 'output', 'runtime'],
    market: ['core', 'output', 'physical', 'runtime'],
    release: ['core', 'seal', 'runtime', 'output', 'physical'],
  });
  assert.deepEqual(Object.values(MAINNET_V8_PACKAGE_NAMES), MAINNET_V8_ROLE_ORDER.map((role) => `animacraft_v8_${role}`));
  assert.deepEqual(MAINNET_V8_RELEASE_STEPS.map(({ ordinal, kind }) => [ordinal, kind]), [
    ['0', 'PUBLISH'], ['1', 'PUBLISH'], ['2', 'PUBLISH'], ['3', 'PUBLISH'],
    ['4', 'PUBLISH'], ['5', 'PUBLISH'], ['6', 'PUBLISH'],
    ['7', 'INITIALIZE_PROTOCOL'], ['8', 'BOOTSTRAP_RELEASE'], ['9', 'VERIFY_AND_EXPORT'],
  ]);
});

test('source artifacts bind the exact source set, release revision, toolchain, sizes, and hashes', () => {
  const artifact = artifacts('core', 0).sourceArtifact;
  assert.equal(artifact.domain, MAINNET_V8_SOURCE_ARTIFACT_DOMAIN);
  assert.deepEqual(artifact.files.map(({ path }) => path), [
    'Move.lock', 'Move.toml', 'sources/alpha.move', 'sources/zeta.move',
  ]);
  assert.doesNotThrow(() => assertMainnetV8SourceArtifact(artifact));
  assert.equal(mainnetV8SourceCommitment(artifact), sha256MainnetV8Json(artifact));

  const sizeTamper = clone(artifact);
  sizeTamper.files[0].byteLength = String(BigInt(sizeTamper.files[0].byteLength) + 1n);
  assert.doesNotThrow(() => assertMainnetV8SourceArtifact(sizeTamper));
  assert.notEqual(mainnetV8SourceCommitment(sizeTamper), mainnetV8SourceCommitment(artifact));
  const orderTamper = clone(artifact);
  orderTamper.files.reverse();
  assert.throws(() => assertMainnetV8SourceArtifact(orderTamper), expectCode('MAINNET_V8_SOURCE_ARTIFACT_INVALID'));
  const pathTamper = clone(artifact);
  pathTamper.files[2].path = '../alpha.move';
  assert.throws(() => assertMainnetV8SourceArtifact(pathTamper), expectCode('MAINNET_V8_SOURCE_PATH_INVALID'));
});

test('package artifacts bind exact module bytes, normalized dependencies, and build digest', () => {
  const module = mainnetV8PackageModuleRecord('alpha', Uint8Array.of(1, 2, 3));
  assert.deepEqual(module, {
    name: 'alpha', bytesBase64: 'AQID', byteLength: '3', sha256: hash(Buffer.from([1, 2, 3])),
  });
  const artifact = artifacts('runtime', 2).packageArtifact;
  assert.deepEqual(artifact.modules.map(({ name }) => name), ['alpha', 'zeta']);
  assert.deepEqual(artifact.dependencies, [id(1), id(2), id(22)]);
  assert.doesNotThrow(() => assertMainnetV8PackageArtifact(artifact));

  const byteTamper = clone(artifact);
  byteTamper.modules[0].bytesBase64 = 'AQIE';
  assert.throws(() => assertMainnetV8PackageArtifact(byteTamper), expectCode('MAINNET_V8_PACKAGE_ARTIFACT_INVALID'));
  assert.throws(() => buildMainnetV8PackageArtifact({
    role: 'core', modules: [module], dependencies: ['0x2', `0x${'0'.repeat(63)}2`], buildDigest: '1'.repeat(64),
  }), expectCode('MAINNET_V8_PACKAGE_ARTIFACT_INVALID'));
});

test('ABI artifacts strip docs/source locations, decimalize integers, and canonically sort modules and symbols', () => {
  const artifact = artifacts('seal', 1).abiArtifact;
  assert.equal(artifact.domain, MAINNET_V8_ABI_ARTIFACT_DOMAIN);
  assert.deepEqual(artifact.modules.map(({ name }) => name), ['alpha', 'zeta']);
  assert.equal(artifact.modules[0].functions[0].index, '0');
  assert.equal(canonicalMainnetV8Json(artifact).includes('documentation'), false);
  assert.equal(canonicalMainnetV8Json(artifact).includes('sourceLocation'), false);
  assert.doesNotThrow(() => assertMainnetV8AbiArtifact(artifact));

  const orderTamper = clone(artifact);
  orderTamper.modules.reverse();
  assert.throws(() => assertMainnetV8AbiArtifact(orderTamper), expectCode('MAINNET_V8_ABI_INVALID'));
  const docTamper = clone(artifact);
  docTamper.modules[0].functions[0].docs = 'smuggled';
  assert.throws(() => assertMainnetV8AbiArtifact(docTamper), expectCode('MAINNET_V8_ABI_INVALID'));
});

test('Seal policy commitments bind only immutable semantic policy and reject invalid Move-side inputs', () => {
  const policy = buildMainnetV8SealPolicy({
    keyServers: [
      { objectId: '0x02', weight: '2' },
      { objectId: '0x01', weight: 1 },
    ],
    threshold: 2n,
  });
  assert.equal(policy.keyServerSetArtifact.domain, MAINNET_V8_KEY_SERVER_SET_DOMAIN);
  assert.equal(policy.encryptionPolicyArtifact.domain, MAINNET_V8_ENCRYPTION_POLICY_DOMAIN);
  assert.deepEqual(policy.keyServers.map(({ objectId }) => objectId), [
    `0x${'0'.repeat(63)}1`, `0x${'0'.repeat(63)}2`,
  ]);
  assert.deepEqual(policy.keyServers.map(({ weight }) => weight), ['1', '2']);
  assert.equal(policy.threshold, '2');
  assert.equal(policy.keyServerSetCommitment, sha256MainnetV8Json(policy.keyServerSetArtifact));
  assert.equal(policy.encryptionPolicyCommitment, sha256MainnetV8Json(policy.encryptionPolicyArtifact));
  assert.equal(canonicalMainnetV8Json(policy).includes('apiKey'), false);
  assert.doesNotThrow(() => assertMainnetV8SealPolicy(policy));

  assert.throws(() => buildMainnetV8SealPolicy({ keyServers: [], threshold: 1 }), expectCode('MAINNET_V8_SEAL_POLICY_INVALID'));
  assert.throws(() => buildMainnetV8SealPolicy({
    keyServers: [{ objectId: '0x1', weight: 1 }], threshold: 2,
  }), expectCode('MAINNET_V8_SEAL_POLICY_INVALID'));
  const commitmentTamper = clone(policy);
  commitmentTamper.keyServerSetCommitment = 'f'.repeat(64);
  assert.throws(() => assertMainnetV8SealPolicy(commitmentTamper), expectCode('MAINNET_V8_SEAL_POLICY_INVALID'));
});

test('releaseId binds exact Mainnet, sender, clean Git revision, protocol 133, USDC, Seal, and all seven artifacts', () => {
  const plan = fixturePlan();
  assert.equal(plan.chain.chainIdentifier, MAINNET_V8_CHAIN_IDENTIFIER);
  assert.equal(plan.chain.legacyChainIdentifier, MAINNET_V8_LEGACY_CHAIN_IDENTIFIER);
  assert.equal(plan.paymentCoinType, MAINNET_V8_PAYMENT_COIN_TYPE);
  assert.equal(plan.packages.length, 7);
  assert.equal(plan.packages.some((entry) => Object.hasOwn(entry, 'abiArtifact') || Object.hasOwn(entry, 'abiCommitment')), false);
  assert.equal(plan.releaseId, sha256MainnetV8Json(Object.fromEntries(
    Object.entries(plan).filter(([key]) => key !== 'releaseId'),
  )));
  assert.equal(computeReleaseId(plan), plan.releaseId);
  assert.doesNotThrow(() => assertMainnetV8ReleasePlan(plan));

  const dirty = clone(plan);
  dirty.sourceRevision.clean = false;
  assert.throws(() => assertMainnetV8ReleasePlan(dirty), expectCode('MAINNET_V8_PLAN_INVALID'));
  const artifactTamper = clone(plan);
  artifactTamper.packages[3].packageArtifact.modules[0].bytesBase64 = 'AQID';
  artifactTamper.releaseId = sha256MainnetV8Json(Object.fromEntries(
    Object.entries(artifactTamper).filter(([key]) => key !== 'releaseId'),
  ));
  assert.throws(() => assertMainnetV8ReleasePlan(artifactTamper), expectCode('MAINNET_V8_PACKAGE_ARTIFACT_INVALID'));
});

test('Published.toml renderer/parser roundtrips the exact deterministic Sui ephemeral prefix', async () => {
  const root = await mkdtemp(join(tmpdir(), 'animacraft-v8-published-'));
  const entries = MAINNET_V8_ROLE_ORDER.slice(0, 3).map((role, index) => ({
    packageName: MAINNET_V8_PACKAGE_NAMES[role],
    source: join(root, MAINNET_V8_PACKAGE_NAMES[role]),
    publishedAt: id(index + 10),
    originalId: id(index + 10),
    version: '1',
    toolchainVersion: '1.77.2',
    buildConfig: { flavor: 'sui', edition: '2024' },
    upgradeCapability: id(index + 30),
  }));
  const value = { buildEnv: 'mainnet', chainId: MAINNET_V8_LEGACY_CHAIN_IDENTIFIER, entries };
  const text = renderMainnetV8PublishedToml(value);
  assert.match(text, /^# generated by Move\n/);
  assert.match(text, /build-env = "mainnet"\nchain-id = "35834a8a"/);
  assert.deepEqual(parseMainnetV8PublishedToml(text), value);
  assert.equal(renderMainnetV8PublishedToml(parseMainnetV8PublishedToml(text)), text);
  assert.throws(() => parseMainnetV8PublishedToml(text.replace('version = 1', 'version = 01')), expectCode('MAINNET_V8_DECIMAL_INVALID'));
});

test('fsync WAL is hash-linked, append-only, atomically replaced, and CAS protected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'animacraft-v8-release-wal-'));
  await chmod(root, 0o700);
  const path = join(root, 'release.json');
  const plan = fixturePlan();
  let wal = await createMainnetV8ReleaseWal(path, plan, {
    recordedAt: '2026-08-22T00:00:00.000Z', evidence: { transactionDataSha256: '1'.repeat(64) },
  });
  assert.equal(wal.revision, '1');
  assert.equal(wal.events[0].status, 'READY');
  assert.equal((await stat(path)).mode & 0o777, 0o600);

  const firstHead = wal.headEventSha256;
  wal = await appendMainnetV8ReleaseWal(path, {
    expectedRevision: wal.revision,
    expectedHeadEventSha256: wal.headEventSha256,
    ordinal: '0', status: 'SIGNED', recordedAt: '2026-08-22T00:00:01.000Z',
    evidence: { signedTransactionSha256: '2'.repeat(64) },
  });
  wal = await appendMainnetV8ReleaseWal(path, {
    expectedRevision: wal.revision,
    expectedHeadEventSha256: wal.headEventSha256,
    ordinal: '0', status: 'OUTCOME_PENDING', recordedAt: '2026-08-22T00:00:02.000Z',
    evidence: { digest: 'pending' },
  });
  wal = await appendMainnetV8ReleaseWal(path, {
    expectedRevision: wal.revision,
    expectedHeadEventSha256: wal.headEventSha256,
    ordinal: '0', status: 'OUTCOME_PENDING', recordedAt: '2026-08-22T00:00:03.000Z',
    evidence: { digest: 'same-bytes-rebroadcast' },
  });
  wal = await appendMainnetV8ReleaseWal(path, {
    expectedRevision: wal.revision,
    expectedHeadEventSha256: wal.headEventSha256,
    ordinal: '0', status: 'FINALIZED', recordedAt: '2026-08-22T00:00:04.000Z',
    evidence: { success: true, certificateSha256: '3'.repeat(64) },
  });
  wal = await appendMainnetV8ReleaseWal(path, {
    expectedRevision: wal.revision,
    expectedHeadEventSha256: wal.headEventSha256,
    ordinal: '1', status: 'READY', recordedAt: '2026-08-22T00:00:05.000Z',
    evidence: { transactionDataSha256: '4'.repeat(64) },
  });
  assert.equal(wal.revision, '6');
  assert.equal(wal.events.length, 6);
  assert.equal(wal.events[1].previousEventSha256, firstHead);
  assert.deepEqual(await readMainnetV8ReleaseWal(path), wal);
  assert.deepEqual((await readdir(root)).filter((name) => name.endsWith('.tmp') || name.endsWith('.lock')), []);

  await assert.rejects(() => appendMainnetV8ReleaseWal(path, {
    expectedRevision: '1', expectedHeadEventSha256: firstHead,
    ordinal: '1', status: 'SIGNED', evidence: {},
  }), expectCode('MAINNET_V8_WAL_CAS_MISMATCH'));
  assert.deepEqual(await readMainnetV8ReleaseWal(path), wal);

  const tampered = JSON.parse(await readFile(path, 'utf8'));
  tampered.events[0].evidence.transactionDataSha256 = 'f'.repeat(64);
  await writeFile(path, `${canonicalMainnetV8Json(tampered)}\n`, { mode: 0o600 });
  await assert.rejects(() => readMainnetV8ReleaseWal(path), expectCode('MAINNET_V8_WAL_INVALID'));
});

test('runner-facing WAL aliases accept object CAS events and durably include optional blobs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'animacraft-v8-runner-wal-'));
  const path = join(root, 'runner.json');
  const plan = fixturePlan();
  let wal = await createReleaseWal({
    path,
    plan,
    event: { status: 'READY', recordedAt: '2026-08-22T01:00:00.000Z', evidence: { prepared: true } },
  });
  wal = await appendReleaseWal({
    path,
    expectedRevision: wal.revision,
    expectedHeadHash: wal.headEventSha256,
    event: {
      ordinal: '0', status: 'SIGNED', recordedAt: '2026-08-22T01:00:01.000Z',
      evidence: { transactionDataSha256: 'a'.repeat(64) },
    },
    blobs: { signedTransaction: { encoding: 'BASE64', data: 'AQID' } },
  });
  assert.deepEqual(wal.events[1].evidence.blobs, {
    signedTransaction: { encoding: 'BASE64', data: 'AQID' },
  });
  assert.deepEqual(await readReleaseWal({ path }), wal);
});
