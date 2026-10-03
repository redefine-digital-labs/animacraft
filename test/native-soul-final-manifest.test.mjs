import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { toBase58 } from '@mysten/sui/utils';
import {
  MAINNET_V8_ROLE_ORDER, MAINNET_V8_PUBLISH_ORDER, MAINNET_V8_PUBLISH_PACKAGE_NAMES,
  MAINNET_V8_RELEASE_PLAN_SCHEMA, MAINNET_V8_RELEASE_STEPS, MAINNET_V8_PROTOCOL_PROFILE,
  MAINNET_V8_CHAIN_IDENTIFIER, MAINNET_V8_LEGACY_CHAIN_IDENTIFIER, MAINNET_V8_RELEASE_SIGNER,
  MAINNET_V8_PAYMENT_COIN_TYPE, MAINNET_V8_SUI_VERSION, MAINNET_V8_SUI_VERSION_OUTPUT,
  MAINNET_V8_SUI_SOURCE_COMMIT, MAINNET_V8_SUI_BINARY_SHA256, MAINNET_V8_FRAMEWORK_REVISION,
  MAINNET_V8_BROWSER_KEY_SERVERS, MAINNET_V8_BROWSER_SEAL_THRESHOLD, buildMainnetV8SourceArtifact, mainnetV8SourceCommitment,
  buildMainnetV8SealPolicyTemplate, assertMainnetV8SourcePlan,
  buildMainnetV8FinalManifestContents, assertMainnetV8FinalManifestContents,
  buildMainnetV8FinalManifest, assertMainnetV8FinalManifest,
  mainnetV8CatalogCommitmentsFromFinalManifest, 
  assertMainnetV8FinalPackageVerification,
} from '../scripts/mainnet-v8-release-lib.mjs';

const order = ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'soulidity', 'release'];
const catalog = ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release'];
const id = n => `0x${n.toString(16).padStart(64, '0')}`;
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = v => JSON.stringify(v, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const digest = n => toBase58(Uint8Array.from({ length: 32 }, (_, i) => (n + i) % 256));
function fixture() {
  const toolchain = { suiVersion: MAINNET_V8_SUI_VERSION, suiVersionOutput: MAINNET_V8_SUI_VERSION_OUTPUT,
    suiSourceCommit: MAINNET_V8_SUI_SOURCE_COMMIT, suiBinarySha256: MAINNET_V8_SUI_BINARY_SHA256,
    frameworkRevision: MAINNET_V8_FRAMEWORK_REVISION };
  // Content-addressed, isolated source data. No claim these are compiled modules
  // or verified chain receipts: this suite exercises manifest data integrity.
  const sourceRevision = { schema: 'animacraft.native-source-snapshot.v1', repositories: {
    animacraft: { baseGitCommit: '1'.repeat(40), baseGitTree: '2'.repeat(40) },
    soulidity: { baseGitCommit: '3'.repeat(40), baseGitTree: '4'.repeat(40) },
  }, packages: order.map(role => {
    const files = ['Move.lock', 'Move.toml', 'sources/main.move'].map(path => ({ path,
      sha256: hash(`${role}/${path}`), byteLength: String(Buffer.byteLength(`${role}/${path}`)) }));
    return { role, packageName: MAINNET_V8_PUBLISH_PACKAGE_NAMES[role],
      repository: role === 'soulidity' ? 'soulidity' : 'animacraft', files, originalFiles: structuredClone(files) };
  }) };
  sourceRevision.snapshotSha256 = hash(canonical(sourceRevision));
  const plan = { schemaVersion: MAINNET_V8_RELEASE_PLAN_SCHEMA, sourceRevision, toolchain,
    chain: { network: 'mainnet', chainIdentifier: MAINNET_V8_CHAIN_IDENTIFIER, legacyChainIdentifier: MAINNET_V8_LEGACY_CHAIN_IDENTIFIER },
    sender: MAINNET_V8_RELEASE_SIGNER, protocolProfile: structuredClone(MAINNET_V8_PROTOCOL_PROFILE),
    paymentCoinType: MAINNET_V8_PAYMENT_COIN_TYPE, steps: structuredClone(MAINNET_V8_RELEASE_STEPS),
    sealPolicy: buildMainnetV8SealPolicyTemplate({ keyServers: MAINNET_V8_BROWSER_KEY_SERVERS.map(({ objectId }) => ({ objectId, weight: '1' })), threshold: MAINNET_V8_BROWSER_SEAL_THRESHOLD }),
    packages: sourceRevision.packages.map(source => {
      const sourceArtifact = buildMainnetV8SourceArtifact({ ...source, toolchain,
        release: { snapshotSha256: sourceRevision.snapshotSha256, repository: source.repository,
          ...sourceRevision.repositories[source.repository] } });
      return { role: source.role, packageName: source.packageName, sourceArtifact, sourceCommitment: mainnetV8SourceCommitment(sourceArtifact) };
    }),
  };
  plan.executionPlanId = hash(canonical(plan)); assertMainnetV8SourcePlan(plan);
  const packages = order.map((role, index) => ({ role, packageId: id(index + 100), packageDigest: digest(index + 1),
    packageVersion: '1', upgradeCapId: id(index + 200), publishDigest: digest(index + 21),
    sourceCommitment: plan.packages[index].sourceCommitment, packageCommitment: hash(`package/${role}`),
    abiCommitment: hash(`abi/${role}`), finalityEvidenceSha256: hash(`finality/${role}`), readbackSha256: hash(`readback/${role}`) }));
  return { plan, packages };
}
const build = f => buildMainnetV8FinalManifestContents(f);
const rehash = manifest => { delete manifest.releaseId; manifest.releaseId = hash(canonical(manifest)); };
test('actual manifest data path binds eight ordered publications while preserving seven Catalog roles', () => {
  const f = fixture(), manifest = build(f);
  assert.deepEqual(MAINNET_V8_PUBLISH_ORDER, order); assert.deepEqual(MAINNET_V8_ROLE_ORDER, catalog);
  assert.deepEqual(manifest.packages.map(p => p.role), order);
  assert.equal(assertMainnetV8FinalManifestContents(manifest, f.plan), manifest);
  assert.equal(manifest.releaseId, hash(canonical(Object.fromEntries(Object.entries(manifest).filter(([k]) => k !== 'releaseId')))));
  assert.deepEqual(build({ ...f, sealPolicy: manifest.sealPolicy }), manifest);
  const commitments = mainnetV8CatalogCommitmentsFromFinalManifest(manifest, f.plan);
  assert.deepEqual(Object.keys(commitments), catalog); assert.equal('soulidity' in commitments, false);
  assert.deepEqual(commitments.release, { source: f.packages[7].sourceCommitment,
    package: f.packages[7].packageCommitment, abi: f.packages[7].abiCommitment });
  assert.notEqual(commitments.release.package, f.packages[6].packageCommitment);
});
test('public final manifest preserves exact contents and the complete schedule', () => {
  const f = fixture(), manifest = build(f);
  assert.deepEqual(buildMainnetV8FinalManifest(f), manifest);
  assert.deepEqual(assertMainnetV8FinalManifest(manifest, f.plan), manifest);
  assert.equal(MAINNET_V8_RELEASE_STEPS.filter(s => s.kind === 'PUBLISH').length, 8);
  assert.deepEqual(MAINNET_V8_RELEASE_STEPS.slice(8).map(s => s.kind),
    ['INITIALIZE_PROTOCOL', 'SETUP_RELEASE', 'BEGIN_BOOTSTRAP', 'FINALIZE_BOOTSTRAP', 'ACTIVATE_SOULIDITY_MARKET', 'VERIFY_AND_EXPORT']);
});
for (const [name, change] of Object.entries({
  'missing Soulidity': rows => rows.splice(6, 1),
  'old seven roles': rows => rows.pop(),
  'Soulidity and Release reordered': rows => [rows[6], rows[7]] = [rows[7], rows[6]],
  'duplicate role': rows => rows[6].role = 'release',
  'foreign role': rows => rows[6].role = 'legacy',
  'extra publication': rows => rows.push(structuredClone(rows[0])),
  'forged source commitment': rows => rows[6].sourceCommitment = rows[7].sourceCommitment,
  'zero package ID': rows => rows[6].packageId = id(0),
  'short package ID': rows => rows[6].packageId = '0x1234',
  'uppercase package ID': rows => rows[6].packageId = `0x${'AB'.repeat(32)}`,
  'duplicate package ID': rows => rows[6].packageId = rows[7].packageId,
  'duplicate upgrade cap': rows => rows[6].upgradeCapId = rows[7].upgradeCapId,
  'same package and cap': rows => rows[6].upgradeCapId = rows[6].packageId,
  'cross-role package/cap collision': rows => rows[7].upgradeCapId = rows[6].packageId,
  'reverse cross-role collision': rows => rows[7].packageId = rows[6].upgradeCapId,
  'nonfresh version': rows => rows[6].packageVersion = '2',
  'numeric version': rows => rows[6].packageVersion = 1,
  'invalid digest': rows => rows[6].packageDigest = 'wrong',
  'invalid evidence hash': rows => rows[6].readbackSha256 = 'a',
  'unknown row field': rows => rows[6].legacyProvenance = id(12),
})) test(`both build and cold manifest contents reject ${name}`, () => {
  const f = fixture(), manifest = structuredClone(build(f));
  change(f.packages); assert.throws(() => build(f));
  change(manifest.packages); rehash(manifest);
  assert.throws(() => assertMainnetV8FinalManifestContents(manifest, f.plan));
});
for (const [name, change] of Object.entries({
  'chain': m => m.chainIdentifier = '35834a8a', 'sender': m => m.sender = id(999),
  'execution plan': m => m.executionPlanId = 'b'.repeat(64),
  'schema': m => m.schemaVersion = 'legacy', 'unknown field': m => m.legacy = true,
  'Seal package binding': m => m.sealPolicy.encryptionPolicyArtifact.sealPackageCommitment = m.packages[6].packageCommitment,
})) test(`cold manifest rejects recomputed identity ${name}`, () => {
  const f = fixture(), manifest = structuredClone(build(f)); change(manifest); rehash(manifest);
  assert.throws(() => assertMainnetV8FinalManifestContents(manifest, f.plan));
});
test('changing even a valid-looking Soulidity receipt ID without resealing fails the release commitment', () => {
  const f = fixture(), manifest = structuredClone(build(f)); manifest.packages[6].packageId = id(998);
  assert.throws(() => assertMainnetV8FinalManifestContents(manifest, f.plan));
  // A rehashed arbitrary receipt is NOT proof of chain publication; the public
  // WAL's assertManifestMatchesPublishEvidence must still match full certificates.
});
test('Soulidity artifact affects release ID but never becomes a Catalog commitment', () => {
  const f = fixture(), first = build(f), prior = mainnetV8CatalogCommitmentsFromFinalManifest(first, f.plan);
  f.packages[6].packageCommitment = hash('changed Soulidity compiled artifact');
  const next = build(f);
  assert.notEqual(first.releaseId, next.releaseId);
  assert.deepEqual(prior, mainnetV8CatalogCommitmentsFromFinalManifest(next, f.plan));
});
test('fully rehashed source artifacts cannot retain a copied execution plan ID', () => {
  const f = fixture(), previous = build(f), oldId = f.plan.executionPlanId;
  const source = f.plan.sourceRevision.packages[6];
  for (const rows of [source.files, source.originalFiles]) rows[2].sha256 = hash('changed real source bytes');
  delete f.plan.sourceRevision.snapshotSha256;
  f.plan.sourceRevision.snapshotSha256 = hash(canonical(f.plan.sourceRevision));
  f.plan.packages = f.plan.sourceRevision.packages.map((row, index) => {
    const sourceArtifact = buildMainnetV8SourceArtifact({ ...row, toolchain: f.plan.toolchain,
      release: { snapshotSha256: f.plan.sourceRevision.snapshotSha256, repository: row.repository,
        ...f.plan.sourceRevision.repositories[row.repository] } });
    const sourceCommitment = mainnetV8SourceCommitment(sourceArtifact);
    f.packages[index].sourceCommitment = sourceCommitment;
    return { role: row.role, packageName: row.packageName, sourceArtifact, sourceCommitment };
  });
  assertMainnetV8SourcePlan(f.plan); assert.equal(f.plan.executionPlanId, oldId);
  assert.throws(() => build(f), { code: 'MAINNET_V8_FINAL_MANIFEST_INVALID' });
  delete f.plan.executionPlanId; f.plan.executionPlanId = hash(canonical(f.plan));
  assert.notEqual(f.plan.executionPlanId, oldId);
  assert.doesNotThrow(() => build(f));
  assert.throws(() => assertMainnetV8FinalManifestContents(previous, f.plan));
});
test('manifest and Catalog results are isolated frozen snapshots of caller input', () => {
  const f = fixture(), manifest = build(f), commitment = manifest.packages[6].packageCommitment;
  f.packages[6].packageCommitment = hash('mutated after build');
  assert.equal(manifest.packages[6].packageCommitment, commitment);
  assert.ok(Object.isFrozen(manifest) && Object.isFrozen(manifest.packages[6]));
  assert.throws(() => manifest.packages[6].packageId = id(1), TypeError);
  const projected = mainnetV8CatalogCommitmentsFromFinalManifest(manifest, f.plan);
  assert.ok(Object.isFrozen(projected.release));
});
function verificationFixture() {
  const f = fixture(), manifest = build(f);
  return { kind: 'FINAL_PACKAGE_REBUILD_VERIFICATION', executionPlanId: f.plan.executionPlanId, releaseId: manifest.releaseId,
    packages: f.packages.map(({ upgradeCapId, finalityEvidenceSha256, ...row }) => ({ ...row,
      moduleMapSha256: hash(`modules/${row.role}`), objectBcsSha256: hash(`object/${row.role}`) })) };
}
test('actual final rebuild verification accepts all eight publications, including Soulidity', () => {
  const value = verificationFixture();
  assert.equal(assertMainnetV8FinalPackageVerification(value), value);
});
for (const [name, change] of Object.entries({
  seven: v => v.packages.splice(6, 1), reorder: v => [v.packages[6], v.packages[7]] = [v.packages[7], v.packages[6]],
  duplicateId: v => v.packages[6].packageId = v.packages[7].packageId,
  badVersion: v => v.packages[6].packageVersion = '2',
})) test(`actual final rebuild verification rejects ${name}`, () => {
  const value = verificationFixture(); change(value); assert.throws(() => assertMainnetV8FinalPackageVerification(value));
});
